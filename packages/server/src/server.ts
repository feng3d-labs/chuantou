/**
 * @module server
 * @description 穿透服务端核心模块，提供内网穿透转发服务器的主体实现。
 * 负责创建 HTTP/HTTPS 服务器、WebSocket 控制通道，并协调会话管理、HTTP 代理和 WebSocket 代理等子模块。
 */

import { WebSocketServer } from 'ws';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { ServerConfig, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';
import { SessionManager } from './session-manager.js';
import { ControlHandler } from './handlers/control-handler.js';
import { HttpProxyHandler } from './handlers/http-proxy.js';
import { WsProxyHandler } from './handlers/ws-proxy.js';

/**
 * 服务器状态信息接口
 *
 * 描述当前转发服务器的运行状态，包括运行情况、网络配置、连接统计等信息。
 */
export interface ServerStatus {
  /** 服务器是否正在运行 */
  running: boolean;
  /** 服务器监听的主机地址 */
  host: string;
  /** 控制通道端口号 */
  controlPort: number;
  /** 是否启用了 TLS 加密 */
  tls: boolean;
  /** 服务器运行时长（毫秒） */
  uptime: number;
  /** 已认证的客户端数量 */
  authenticatedClients: number;
  /** 已注册的端口总数 */
  totalPorts: number;
  /** 当前活跃连接数 */
  activeConnections: number;
}

/**
 * 转发服务器
 *
 * 穿透系统的服务端核心类，负责：
 * - 创建并管理 HTTP/HTTPS 服务器
 * - 处理 WebSocket 控制通道连接
 * - 协调会话管理、HTTP 代理和 WebSocket 代理
 * - 提供服务器状态查询和管理端点
 */
export class ForwardServer {
  /** 服务器配置 */
  private config: ServerConfig;
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** HTTP 代理处理器 */
  private httpProxyHandler: HttpProxyHandler;
  /** WebSocket 代理处理器 */
  private wsProxyHandler: WsProxyHandler;
  /** 控制通道处理器 */
  private controlHandler: ControlHandler;
  /** WebSocket 控制服务器 */
  private controlServer: WebSocketServer;
  /** HTTP/HTTPS 服务器实例 */
  private httpServer?: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
  /** 统计信息定时器 */
  private statsInterval?: ReturnType<typeof setInterval>;
  /** 服务器启动时间戳 */
  private startedAt?: number;

  /**
   * 创建转发服务器实例
   *
   * @param options - 服务器配置选项，未提供的字段将使用默认值
   */
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
    this.httpProxyHandler = new HttpProxyHandler(this.sessionManager);
    this.wsProxyHandler = new WsProxyHandler(this.sessionManager);
    this.controlHandler = new ControlHandler(
      this.sessionManager,
      this.config,
      this.httpProxyHandler,
      this.wsProxyHandler
    );
    this.controlServer = new WebSocketServer({ noServer: true });
  }

  /**
   * 启动服务器
   *
   * 创建 HTTP 或 HTTPS 服务器，绑定请求处理和 WebSocket 升级事件，
   * 开始监听控制端口，并启动定时统计输出。
   *
   * @returns 服务器启动完成的 Promise
   */
  async start(): Promise<void> {
    const serverOptions = this.config.tls ? {
      key: this.config.tls.key,
      cert: this.config.tls.cert,
    } : undefined;

    this.httpServer = serverOptions
      ? createHttpsServer(serverOptions)
      : createHttpServer();

    this.httpServer.on('request', (req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      this.controlServer.handleUpgrade(req, socket, head, (ws) => {
        this.controlHandler.handleConnection(ws);
      });
    });

    this.httpServer.on('error', (error) => {
      console.error('服务器错误:', error);
    });

    this.httpServer.listen(this.config.controlPort, this.config.host, () => {
      const protocol = this.config.tls ? 'https/wss' : 'http/ws';
      console.log(`控制服务器正在监听 ${protocol}://${this.config.host}:${this.config.controlPort}`);
    });

    this.startedAt = Date.now();

    this.statsInterval = setInterval(() => {
      const stats = this.sessionManager.getStats();
      console.log(`统计: ${stats.authenticatedClients} 个已认证客户端, ${stats.totalPorts} 个端口, ${stats.totalConnections} 个连接`);
    }, 60000);
  }

  /**
   * 处理 HTTP 请求（包含管理端点）
   *
   * 提供以下管理端点：
   * - `GET /_chuantou/status` — 返回服务器状态信息
   * - `POST /_chuantou/stop` — 停止服务器
   * - 其他请求返回默认欢迎页
   *
   * @param req - HTTP 请求对象
   * @param res - HTTP 响应对象
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.url === '/_chuantou/status' && req.method === 'GET') {
      const status = this.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.url === '/_chuantou/stop' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: '服务器正在停止' }));
      this.stop();
      return;
    }

    res.writeHead(200);
    res.end('穿透服务器正在运行');
  }

  /**
   * 停止服务器
   *
   * 依次停止统计定时器、WebSocket 控制服务器、HTTP 服务器，
   * 以及所有 HTTP 和 WebSocket 代理，最后清理所有会话。
   *
   * @returns 服务器完全停止后的 Promise
   */
  async stop(): Promise<void> {
    console.log('正在停止服务器...');

    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = undefined;
    }

    this.controlServer.close();

    if (this.httpServer) {
      this.httpServer.close();
    }

    await this.httpProxyHandler.stopAll();
    await this.wsProxyHandler.stopAll();

    this.sessionManager.clear();

    console.log('服务器已停止');
  }

  /**
   * 获取服务器状态
   *
   * 汇总当前服务器的运行状态、网络配置和连接统计等信息。
   *
   * @returns 包含服务器运行状态的 {@link ServerStatus} 对象
   */
  getStatus(): ServerStatus {
    const stats = this.sessionManager.getStats();
    return {
      running: this.httpServer?.listening ?? false,
      host: this.config.host,
      controlPort: this.config.controlPort,
      tls: this.config.tls !== undefined,
      uptime: this.startedAt ? Date.now() - this.startedAt : 0,
      authenticatedClients: stats.authenticatedClients,
      totalPorts: stats.totalPorts,
      activeConnections: stats.totalConnections,
    };
  }

  /**
   * 获取服务器配置
   *
   * @returns 当前服务器使用的 {@link ServerConfig} 配置对象
   */
  getConfig(): ServerConfig {
    return this.config;
  }

  /**
   * 获取会话管理器
   *
   * @returns 当前服务器使用的 {@link SessionManager} 会话管理器实例
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
