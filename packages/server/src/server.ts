/**
 * @module server
 *
 * 穿透服务端核心模块。
 *
 * 在控制端口上同时支持三种通道：
 * - WebSocket 控制通道（认证、心跳、注册等控制消息）
 * - TCP 二进制数据通道（HTTP/WS/TCP 原始数据传输）
 * - UDP 数据通道（UDP 原始数据传输）
 *
 * 通过首字节检测区分 WebSocket 和 TCP 数据通道连接。
 */

import { WebSocketServer } from 'ws';
import { createServer as createHttpServer, IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { createServer as createTcpServer, Server as TcpServer, Socket } from 'net';
import { createSocket as createUdpSocket, Socket as UdpSocket } from 'dgram';
import { readFile } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ServerConfig, DEFAULT_CONFIG, logger, isDataChannelAuth } from '@feng3d/chuantou-shared';
import { SessionManager } from './session-manager.js';
import { ControlHandler } from './handlers/control-handler.js';
import { UnifiedProxyHandler } from './handlers/unified-proxy.js';
import { DataChannelManager } from './data-channel.js';

/**
 * 服务器状态信息接口
 */
export interface ServerStatus {
  running: boolean;
  host: string;
  controlPort: number;
  tls: boolean;
  uptime: number;
  authenticatedClients: number;
  totalPorts: number;
  activeConnections: number;
}

/**
 * 转发服务器
 *
 * 在控制端口上通过协议复用同时支持：
 * - WebSocket 控制通道（HTTP 升级）
 * - TCP 二进制数据通道（魔数 0xFD 0x01 开头）
 * - UDP 数据通道（dgram，自然与 TCP 分离）
 */
export class ForwardServer {
  private config: ServerConfig;
  private sessionManager: SessionManager;
  private dataChannelManager: DataChannelManager;
  private proxyHandler: UnifiedProxyHandler;
  private controlHandler: ControlHandler;
  private controlServer: WebSocketServer;
  /** 底层 TCP 服务器（协议复用入口） */
  private tcpServer?: TcpServer;
  /** HTTP 服务器（处理管理端点和 WS 升级，不直接 listen） */
  private httpServer?: HttpServer;
  /** 控制端口 UDP socket */
  private udpSocket?: UdpSocket;
  private statsInterval?: ReturnType<typeof setInterval>;
  private startedAt?: number;

  /**
   * 静态文件目录常量
   */
  private static readonly STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-ui', 'dist');

  constructor(options: Partial<ServerConfig> = {}) {
    this.config = {
      host: options.host ?? '0.0.0.0',
      controlPort: options.controlPort ?? DEFAULT_CONFIG.CONTROL_PORT,
      authTokens: options.authTokens ?? [],
      heartbeatInterval: options.heartbeatInterval ?? DEFAULT_CONFIG.HEARTBEAT_INTERVAL,
      sessionTimeout: options.sessionTimeout ?? DEFAULT_CONFIG.SESSION_TIMEOUT,
      tls: options.tls,
    };
    this.sessionManager = new SessionManager(
      this.config.heartbeatInterval,
      this.config.sessionTimeout
    );
    this.dataChannelManager = new DataChannelManager(this.sessionManager);
    this.proxyHandler = new UnifiedProxyHandler(this.sessionManager, this.dataChannelManager);
    this.controlHandler = new ControlHandler(
      this.sessionManager,
      this.config,
      this.proxyHandler,
      this.dataChannelManager,
    );
    this.controlServer = new WebSocketServer({ noServer: true });
  }

  /**
   * 启动服务器
   *
   * 创建底层 TCP 服务器进行协议复用，同时创建 UDP socket。
   */
  async start(): Promise<void> {
    // 创建 HTTP 服务器（不直接 listen，由 TCP 服务器转发连接）
    const serverOptions = this.config.tls ? {
      key: this.config.tls.key,
      cert: this.config.tls.cert,
    } : undefined;

    this.httpServer = serverOptions
      ? createHttpsServer(serverOptions) as unknown as HttpServer
      : createHttpServer();

    this.httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      this.controlServer.handleUpgrade(req, socket, head, (ws) => {
        this.controlHandler.handleConnection(ws);
      });
    });

    // 创建底层 TCP 服务器进行协议复用
    this.tcpServer = createTcpServer({ pauseOnConnect: true });

    this.tcpServer.on('connection', (socket: Socket) => {
      socket.on('error', (error) => {
        logger.error('控制端口连接错误:', error.message);
        socket.destroy();
      });

      socket.once('readable', () => {
        const data = socket.read(Math.min(socket.readableLength || 1024, 1024)) as Buffer | null;

        if (!data) {
          socket.once('data', (firstData: Buffer) => {
            this.routeConnection(socket, firstData);
          });
          socket.resume();
          return;
        }

        this.routeConnection(socket, data);
      });
    });

    this.tcpServer.on('error', (error) => {
      logger.error('服务器错误:', error);
    });

    // 创建 UDP socket
    this.udpSocket = createUdpSocket('udp4');
    this.dataChannelManager.setUdpSocket(this.udpSocket);

    this.udpSocket.on('message', (msg, rinfo) => {
      this.dataChannelManager.handleUdpMessage(msg, rinfo);
    });

    this.udpSocket.on('error', (error) => {
      logger.error('控制端口 UDP 错误:', error);
    });

    // 启动监听
    return new Promise<void>((resolve, reject) => {
      this.tcpServer!.listen(this.config.controlPort, this.config.host, () => {
        const actualPort = (this.tcpServer!.address() as { port: number }).port;

        this.udpSocket!.bind(actualPort, this.config.host, () => {
          const protocol = this.config.tls ? 'https/wss' : 'http/ws';
          logger.log(`控制服务器正在监听 ${protocol}://${this.config.host}:${actualPort} (TCP + UDP)`);

          this.startedAt = Date.now();
          this.statsInterval = setInterval(() => {
            const stats = this.sessionManager.getStats();
            logger.log(`统计: ${stats.authenticatedClients} 个已认证客户端, ${stats.totalPorts} 个端口, ${stats.totalConnections} 个连接`);
          }, 60000);

          resolve();
        });
      });

      this.tcpServer!.on('error', reject);
      this.udpSocket!.on('error', reject);
    });
  }

  /**
   * 根据首字节路由 TCP 连接
   *
   * - 魔数 0xFD 0x01 → TCP 数据通道
   * - HTTP 方法开头 → HTTP 服务器（管理端点 + WebSocket 升级）
   */
  private routeConnection(socket: Socket, data: Buffer): void {
    if (isDataChannelAuth(data)) {
      // 二进制数据通道
      this.dataChannelManager.handleNewTcpConnection(socket, data);
    } else {
      // HTTP / WebSocket — 回推数据，交给 HTTP 服务器处理
      socket.unshift(data);
      this.httpServer!.emit('connection', socket);
    }
  }

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // 静态文件服务 - 首页读取模板文件
    if (url === '/' && req.method === 'GET') {
      const templatePath = join(ForwardServer.STATIC_DIR, 'index.html');
      readFile(templatePath, 'utf-8', (err, data) => {
        if (err) {
          console.error('模板文件读取错误:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Error loading page');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        }
      });
      return;
    }

    // 处理静态文件请求 (支持 .js, .css 等静态资源直接从根路径访问）
    if (req.method === 'GET' && url !== '/' && !url.startsWith('/_chuantou/')) {
      const fileName = url.slice(1) as string; // 去掉开头的 /
      const filePath = join(ForwardServer.STATIC_DIR, fileName);

      readFile(filePath, 'utf-8', (err, data) => {
        if (err || !data) {
          console.error('静态文件读取错误:', err);
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('File not found');
          return;
        }
        const ext = fileName.split('.').pop() || 'html';
        const contentType = ext === 'css' ? 'text/css; charset=utf-8' :
                         ext === 'js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(data);
      });
      return;
    }

    // 服务器状态 API
    if (url === '/_chuantou/status' && req.method === 'GET') {
      const status = this.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // 客户端会话列表 API
    if (url === '/_chuantou/sessions' && req.method === 'GET') {
      const sessions = this.sessionManager.getSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }

    // 端口映射列表 API
    if (url === '/_chuantou/ports' && req.method === 'GET') {
      const sessions = this.sessionManager.getSessions();
      const ports: Array<{ port: number; clientId: string; connections: number; description: string }> = [];

      // 添加客户端注册的端口
      for (const session of sessions) {
        const clientInfo = this.sessionManager.getClientInfo(session.clientId);
        if (clientInfo) {
          for (const port of clientInfo.registeredPorts) {
            // 获取该端口的活跃连接数
            const connectionCount = clientInfo.connections.size;
            ports.push({
              port,
              clientId: session.clientId,
              connections: connectionCount,
              description: '客户端反向代理端口',
            });
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ports }));
      return;
    }

    // 断开客户端会话 API
    if (url.startsWith('/_chuantou/sessions/') && url.endsWith('/disconnect') && req.method === 'POST') {
      const clientId = url.slice('/_chuantou/sessions/'.length, -'/disconnect'.length);
      const clientInfo = this.sessionManager.getClientInfo(clientId);
      if (clientInfo) {
        // 关闭 WebSocket 连接
        const socket = this.sessionManager.getClientSocket(clientId);
        if (socket) {
          socket.close();
        }
        this.sessionManager.removeSession(clientId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '客户端已断开' }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: '客户端不存在' }));
      }
      return;
    }

    // 清理孤立端口 API（删除在 UnifiedProxyHandler 中存在但不在 SessionManager 中的端口）
    if (url === '/_chuantou/cleanup' && req.method === 'POST') {
      const activePorts = this.proxyHandler.getActivePorts();
      const registeredPorts = this.sessionManager.getAllRegisteredPorts();
      const orphanPorts: number[] = [];

      for (const port of activePorts) {
        if (!registeredPorts.has(port)) {
          orphanPorts.push(port);
        }
      }

      if (orphanPorts.length > 0) {
        logger.log(`发现 ${orphanPorts.length} 个孤立端口: ${orphanPorts.join(', ')}`);
      }

      // 清理孤立端口
      const cleanedPorts: number[] = [];
      for (const port of orphanPorts) {
        try {
          await this.proxyHandler.stopProxy(port);
          cleanedPorts.push(port);
          logger.log(`已清理孤立端口: ${port}`);
        } catch (error) {
          logger.error(`清理端口 ${port} 失败:`, error);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        found: orphanPorts.length,
        cleaned: cleanedPorts.length,
        ports: cleanedPorts,
      }));
      return;
    }

    // 停止服务器 API
    if (url === '/_chuantou/stop' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: '服务器正在停止' }));
      this.stop();
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  async stop(): Promise<void> {
    logger.log('正在停止服务器...');

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = undefined;
    }

    this.controlServer.close();

    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = undefined;
    }

    if (this.tcpServer) {
      this.tcpServer.close();
      this.tcpServer = undefined;
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = undefined;
    }

    await this.proxyHandler.stopAll();
    this.dataChannelManager.clear();
    this.sessionManager.clear();

    logger.log('服务器已停止');
  }

  getStatus(): ServerStatus {
    const stats = this.sessionManager.getStats();
    return {
      running: this.tcpServer?.listening ?? false,
      host: this.config.host,
      controlPort: this.config.controlPort,
      tls: this.config.tls !== undefined,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      authenticatedClients: stats.authenticatedClients,
      totalPorts: stats.totalPorts,
      activeConnections: stats.totalConnections,
    };
  }

  getConfig(): ServerConfig {
    return this.config;
  }

  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
