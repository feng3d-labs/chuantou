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
import { readFile, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ServerConfig, DEFAULT_CONFIG, logger, isDataChannelAuth } from '@feng3d/chuantou-shared';
import { SessionManager } from './session-manager.js';
import { ControlHandler } from './handlers/control-handler.js';
import { UnifiedProxyHandler } from './handlers/unified-proxy.js';
import { DataChannelManager } from './data-channel.js';

/**
 * 管理页面静态文件目录路径
 */
const ADMIN_UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-ui', 'dist');

/**
 * HTML 模板文件路径
 */
const TEMPLATE_PATH = join(ADMIN_UI_DIR, 'template.html');

/**
 * 获取后备 HTML 页面（当模板文件不存在时使用）
 */
function getFallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>穿透服务器状态</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh; color: #e0e0e0; padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .header {
      text-align: center; margin-bottom: 30px; padding: 30px 20px;
      background: rgba(255,255,255,0.05); border-radius: 16px;
      backdrop-filter: blur(10px); border: 1px solid rgba(255,255,255,0.1);
    }
    .header h1 {
      font-size: 28px; margin-bottom: 8px;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
    }
    .header .status {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 6px 16px; border-radius: 20px; font-size: 14px; font-weight: 500;
    }
    .status.running { background: rgba(0, 255, 136, 0.15); color: #00ff88; }
    .status.running::before {
      content: ""; width: 8px; height: 8px; border-radius: 50%;
      background: #00ff88; animation: pulse 1.5s infinite;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px; margin-bottom: 20px;
    }
    .card {
      background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px;
      border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px);
    }
    .card-label { font-size: 12px; color: #888; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
    .card-value { font-size: 24px; font-weight: 600; color: #fff; }
    .card-value .unit { font-size: 14px; color: #888; font-weight: 400; }
    .sessions {
      background: rgba(255,255,255,0.05); border-radius: 12px; padding: 20px;
      border: 1px solid rgba(255,255,255,0.1); margin-top: 20px;
    }
    .sessions-title { font-size: 14px; color: #888; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.5px; }
    .session-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; background: rgba(0,0,0,0.2); border-radius: 8px; margin-bottom: 8px; font-size: 14px;
    }
    .session-item:last-child { margin-bottom: 0; }
    .session-id { font-family: monospace; color: #00d9ff; }
    .session-time { color: #888; }
    .empty-state { text-align: center; padding: 30px; color: #666; font-size: 14px; }
    .footer { text-align: center; margin-top: 30px; padding: 20px; color: #666; font-size: 12px; }
    .last-update { text-align: center; color: #666; font-size: 12px; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>feng3d-cts 穿透服务器</h1>
      <div class="status running" id="status">运行中</div>
    </div>
    <div class="grid">
      <div class="card"><div class="card-label">监听地址</div><div class="card-value" id="host">-</div></div>
      <div class="card"><div class="card-label">运行时长</div><div class="card-value"><span id="uptime">-</span><span class="unit"> 秒</span></div></div>
      <div class="card"><div class="card-label">客户端</div><div class="card-value"><span id="clients">0</span><span class="unit"> 个</span></div></div>
      <div class="card"><div class="card-label">端口</div><div class="card-value"><span id="ports">0</span><span class="unit"> 个</span></div></div>
      <div class="card"><div class="card-label">连接数</div><div class="card-value"><span id="connections">0</span><span class="unit"> 个</span></div></div>
      <div class="card"><div class="card-label">TLS</div><div class="card-value" id="tls">-</div></div>
    </div>
    <div class="sessions">
      <div class="sessions-title">客户端会话</div>
      <div id="sessions-list"></div>
    </div>
    <div class="last-update">最后更新: <span id="lastUpdate">-</span></div>
    <div class="footer">
      <a href="https://github.com/feng3d/chuantou" target="_blank" style="color: #00d9ff; text-decoration: none;">feng3d-cts</a> — 内网穿透服务端
    </div>
  </div>
  <script>
    function formatUptime(ms) {
      var s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), d = Math.floor(h/24);
      if (d > 0) return d+'天 '+(h%24)+'小时';
      if (h > 0) return h+'小时 '+(m%60)+'分钟';
      if (m > 0) return m+'分钟 '+(s%60)+'秒';
      return s+'秒';
    }
    async function updateStatus() {
      try {
        var res = await fetch('/_chuantou/status');
        var data = await res.json();
        document.getElementById('host').textContent = data.host+':'+data.controlPort;
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('clients').textContent = data.authenticatedClients;
        document.getElementById('ports').textContent = data.totalPorts;
        document.getElementById('connections').textContent = data.activeConnections;
        document.getElementById('tls').textContent = data.tls ? '已启用' : '已禁用';
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('zh-CN');
        var sessionsRes = await fetch('/_chuantou/sessions');
        var sessions = await sessionsRes.json();
        var listEl = document.getElementById('sessions-list');
        if (sessions.length === 0) {
          listEl.innerHTML = '<div class="empty-state">暂无客户端连接</div>';
        } else {
          listEl.innerHTML = sessions.map(function(s) {
            return '<div class="session-item"><span class="session-id">'+s.clientId.slice(0,8)+'...</span><span class="session-time">连接于 '+new Date(s.connectedAt).toLocaleTimeString('zh-CN')+'</span></div>';
          }).join('');
        }
      } catch (e) { console.error('获取状态失败:', e); }
    }
    updateStatus();
    setInterval(updateStatus, 3000);
  </script>
</body>
</html>`;
}

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

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    // 首页 - 读取模板文件
    if (url === '/' && req.method === 'GET') {
      if (existsSync(TEMPLATE_PATH)) {
        readFile(TEMPLATE_PATH, 'utf-8', (err, data) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Error loading page');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
          }
        });
      } else {
        // 如果模板文件不存在，返回简单的内嵌页面
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(getFallbackHtml());
      }
      return;
    }

    // 静态文件服务 (style.css, app.js)
    if (req.method === 'GET' && url !== '/' && !url.startsWith('/_chuantou/')) {
      const fileName = url.slice(1) as string;
      const filePath = join(ADMIN_UI_DIR, fileName);

      readFile(filePath, (err, data) => {
        if (err || !data) {
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
      const ports: Array<{ port: number; clientId: string; connections: number }> = [];
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
