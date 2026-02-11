import { WebSocketServer } from 'ws';
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'http';
import { createServer as createHttpsServer } from 'https';
import { ServerConfig, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';
import { SessionManager } from './session-manager.js';
import { ControlHandler } from './handlers/control-handler.js';
import { HttpProxyHandler } from './handlers/http-proxy.js';
import { WsProxyHandler } from './handlers/ws-proxy.js';

/**
 * 服务器状态信息
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
 */
export class ForwardServer {
  private config: ServerConfig;
  private sessionManager: SessionManager;
  private httpProxyHandler: HttpProxyHandler;
  private wsProxyHandler: WsProxyHandler;
  private controlHandler: ControlHandler;
  private controlServer: WebSocketServer;
  private httpServer?: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;
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
      console.error('Server error:', error);
    });

    this.httpServer.listen(this.config.controlPort, this.config.host, () => {
      const protocol = this.config.tls ? 'https/wss' : 'http/ws';
      console.log(`Control server listening on ${protocol}://${this.config.host}:${this.config.controlPort}`);
    });

    this.startedAt = Date.now();

    this.statsInterval = setInterval(() => {
      const stats = this.sessionManager.getStats();
      console.log(`Stats: ${stats.authenticatedClients} authenticated clients, ${stats.totalPorts} ports, ${stats.totalConnections} connections`);
    }, 60000);
  }

  /**
   * 处理 HTTP 请求（包含管理端点）
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
      res.end(JSON.stringify({ message: 'Server stopping' }));
      this.stop();
      return;
    }

    res.writeHead(200);
    res.end('Chuantou Server is running');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    console.log('Stopping server...');

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

    console.log('Server stopped');
  }

  /**
   * 获取服务器状态
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
   * 获取配置
   */
  getConfig(): ServerConfig {
    return this.config;
  }

  /**
   * 获取会话管理器
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
