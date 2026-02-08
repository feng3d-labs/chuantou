import { WebSocketServer } from 'ws';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Config } from './config.js';
import { SessionManager } from './session-manager.js';
import { ControlHandler } from './handlers/control-handler.js';
import { HttpProxyHandler } from './handlers/http-proxy.js';
import { WsProxyHandler } from './handlers/ws-proxy.js';

/**
 * 转发服务器
 */
export class ForwardServer {
  private config: Config;
  private sessionManager: SessionManager;
  private httpProxyHandler: HttpProxyHandler;
  private wsProxyHandler: WsProxyHandler;
  private controlHandler: ControlHandler;
  private controlServer: WebSocketServer;
  private httpServer?: ReturnType<typeof createHttpServer> | ReturnType<typeof createHttpsServer>;

  constructor(config: Config) {
    this.config = config;
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
    // 启动控制通道WebSocket服务器
    const serverOptions = this.config.isTlsEnabled() ? {
      key: this.config.tls!.key,
      cert: this.config.tls!.cert,
    } : undefined;

    // 创建 HTTP/HTTPS 服务器
    this.httpServer = serverOptions
      ? createHttpsServer(serverOptions)
      : createHttpServer();

    this.httpServer.on('request', (_req, res) => {
      // 处理 HTTP 请求（可以在这里添加代理功能）
      res.writeHead(200);
      res.end('Chuantou Server is running');
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      // 处理 WebSocket 升级请求
      this.controlServer.handleUpgrade(req, socket, head, (ws) => {
        this.controlHandler.handleConnection(ws);
      });
    });

    this.httpServer.on('error', (error) => {
      console.error('Server error:', error);
    });

    this.httpServer.listen(this.config.controlPort, this.config.host, () => {
      const protocol = this.config.isTlsEnabled() ? 'https/wss' : 'http/ws';
      console.log(`Control server listening on ${protocol}://${this.config.host}:${this.config.controlPort}`);
    });

    // 打印统计信息
    setInterval(() => {
      const stats = this.sessionManager.getStats();
      console.log(`Stats: ${stats.authenticatedClients} authenticated clients, ${stats.totalPorts} ports, ${stats.totalConnections} connections`);
    }, 60000); // 每分钟打印一次
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    console.log('Stopping server...');

    // 停止 WebSocket 服务器
    this.controlServer.close();

    // 停止 HTTP 服务器
    if (this.httpServer) {
      this.httpServer.close();
    }

    // 停止所有代理
    await this.httpProxyHandler.stopAll();
    await this.wsProxyHandler.stopAll();

    // 清理会话
    this.sessionManager.clear();

    console.log('Server stopped');
  }

  /**
   * 获取配置
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * 获取会话管理器
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
}
