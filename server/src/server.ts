import { WebSocketServer } from 'ws';
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
  private controlServer?: WebSocketServer;

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
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    // 启动控制通道WebSocket服务器
    this.controlServer = new WebSocketServer({
      port: this.config.controlPort,
      host: this.config.host,
    });

    this.controlServer.on('connection', (ws) => {
      this.controlHandler.handleConnection(ws);
    });

    this.controlServer.on('error', (error) => {
      console.error('Control server error:', error);
    });

    console.log(`Control server listening on ${this.config.host}:${this.config.controlPort}`);

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

    // 停止控制服务器
    if (this.controlServer) {
      this.controlServer.close();
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
