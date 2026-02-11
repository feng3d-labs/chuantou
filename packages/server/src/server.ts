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

/** 状态页面 HTML 模板 */
const STATUS_HTML = `<!DOCTYPE html>
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
      min-height: 100vh;
      color: #e0e0e0;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 30px 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .header h1 {
      font-size: 28px;
      margin-bottom: 8px;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }
    .status.running {
      background: rgba(0, 255, 136, 0.15);
      color: #00ff88;
    }
    .status.running::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00ff88;
      animation: pulse 1.5s infinite;
    }
    .status.stopped {
      background: rgba(255, 77, 77, 0.15);
      color: #ff4d4d;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
    }
    .card-label {
      font-size: 12px;
      color: #888;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card-value {
      font-size: 24px;
      font-weight: 600;
      color: #fff;
    }
    .card-value .unit {
      font-size: 14px;
      color: #888;
      font-weight: 400;
    }
    .sessions {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      margin-top: 20px;
    }
    .sessions-title {
      font-size: 14px;
      color: #888;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .session-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .session-item:last-child {
      margin-bottom: 0;
    }
    .session-id {
      font-family: monospace;
      color: #00d9ff;
    }
    .session-time {
      color: #888;
    }
    .empty-state {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 14px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      color: #666;
      font-size: 12px;
    }
    .last-update {
      text-align: center;
      color: #666;
      font-size: 12px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 feng3d-cts 穿透服务器</h1>
      <div class="status running" id="status">运行中</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">监听地址</div>
        <div class="card-value" id="host">-</div>
      </div>
      <div class="card">
        <div class="card-label">运行时长</div>
        <div class="card-value"><span id="uptime">-</span><span class="unit"> 秒</span></div>
      </div>
      <div class="card">
        <div class="card-label">客户端</div>
        <div class="card-value"><span id="clients">0</span><span class="unit"> 个</span></div>
      </div>
      <div class="card">
        <div class="card-label">端口</div>
        <div class="card-value"><span id="ports">0</span><span class="unit"> 个</span></div>
      </div>
      <div class="card">
        <div class="card-label">连接数</div>
        <div class="card-value"><span id="connections">0</span><span class="unit"> 个</span></div>
      </div>
      <div class="card">
        <div class="card-label">TLS</div>
        <div class="card-value" id="tls">-</div>
      </div>
    </div>

    <div class="sessions">
      <div class="sessions-title">客户端会话</div>
      <div id="sessions-list"></div>
    </div>

    <div class="last-update">最后更新: <span id="lastUpdate">-</span></div>

    <div class="footer">
      <a href="https://github.com/feng3d/chuantou" target="_blank" style="color: #00d9ff; text-decoration: none;">feng3d-cts</a>
      — 内网穿透服务端
    </div>
  </div>

  <script>
    function formatUptime(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return \`\${days}天 \${hours % 24}小时\`;
      if (hours > 0) return \`\${hours}小时 \${minutes % 60}分钟\`;
      if (minutes > 0) return \`\${minutes}分钟 \${seconds % 60}秒\`;
      return \`\${seconds}秒\`;
    }

    function formatTime(timestamp) {
      return new Date(timestamp).toLocaleTimeString('zh-CN');
    }

    async function updateStatus() {
      try {
        const res = await fetch('/_chuantou/status');
        const data = await res.json();

        document.getElementById('host').textContent = data.host + ':' + data.controlPort;
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('clients').textContent = data.authenticatedClients;
        document.getElementById('ports').textContent = data.totalPorts;
        document.getElementById('connections').textContent = data.activeConnections;
        document.getElementById('tls').textContent = data.tls ? '已启用' : '已禁用';
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('zh-CN');

        // 获取会话列表
        const sessionsRes = await fetch('/_chuantou/sessions');
        const sessions = await sessionsRes.json();
        const listEl = document.getElementById('sessions-list');
        if (sessions.length === 0) {
          listEl.innerHTML = '<div class="empty-state">暂无客户端连接</div>';
        } else {
          listEl.innerHTML = sessions.map(s => \`
            <div class="session-item">
              <span class="session-id">\${s.clientId.slice(0, 8)}...</span>
              <span class="session-time">连接于 \${formatTime(s.connectedAt)}</span>
            </div>
          \`).join('');
        }
      } catch (e) {
        console.error('获取状态失败:', e);
      }
    }

    updateStatus();
    setInterval(updateStatus, 3000);
  </script>
</body>
</html>
`;

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
   * - `GET /` — 返回状态监控页面（HTML）
   * - `GET /_chuantou/status` — 返回服务器状态信息（JSON）
   * - `GET /_chuantou/sessions` — 返回会话列表（JSON）
   * - `POST /_chuantou/stop` — 停止服务器（JSON）
   *
   * @param req - HTTP 请求对象
   * @param res - HTTP 响应对象
   */
  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    // 状态监控页面
    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(STATUS_HTML);
      return;
    }

    // 状态 API
    if (url === '/_chuantou/status' && req.method === 'GET') {
      const status = this.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // 会话列表 API
    if (url === '/_chuantou/sessions' && req.method === 'GET') {
      const sessions = this.sessionManager.getSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }

    // 停止服务器 API
    if (url === '/_chuantou/stop' && req.method === 'POST') {
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
