/**
 * @module admin-server
 * @description 客户端管理页面 HTTP 服务器模块。
 * 提供一个本地 HTTP 服务，用于查看客户端状态和管理代理映射。
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { ProxyConfig } from '@feng3d/chuantou-shared';

/**
 * 客户端状态信息接口
 */
export interface ClientStatus {
  /** 是否正在运行 */
  running: boolean;
  /** 服务器地址 */
  serverUrl: string;
  /** 是否已连接 */
  connected: boolean;
  /** 是否已认证 */
  authenticated: boolean;
  /** 运行时长（毫秒） */
  uptime: number;
  /** 已注册的代理列表 */
  proxies: ProxyConfig[];
  /** 重连次数 */
  reconnectAttempts: number;
}

/**
 * 管理页面服务器配置接口
 */
export interface AdminServerConfig {
  /** 监听端口 */
  port: number;
  /** 监听地址 */
  host: string;
}

/**
 * 管理页面服务器类
 *
 * 在本地启动一个 HTTP 服务器，提供状态查询和代理管理的 API 接口，
 * 以及一个可视化的 Web 管理界面。
 */
export class AdminServer {
  /** HTTP 服务器实例 */
  private server: ReturnType<typeof createServer>;
  /** 监听端口 */
  private port: number;
  /** 监听地址 */
  private host: string;
  /** 启动时间 */
  private startedAt: number;
  /** 获取状态回调函数 */
  private getStatusCallback: () => ClientStatus;
  /** 添加代理回调函数 */
  private addProxyCallback: (proxy: ProxyConfig) => Promise<void>;
  /** 删除代理回调函数 */
  private removeProxyCallback: (remotePort: number) => Promise<void>;

  /**
   * 状态页面 HTML 模板
   */
  private static readonly STATUS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>穿透客户端管理</title>
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
      max-width: 900px;
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
    .status {
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
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
      font-size: 20px;
      font-weight: 600;
      color: #fff;
    }
    .card-value .unit {
      font-size: 14px;
      color: #888;
      font-weight: 400;
    }
    .proxies-section {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      margin-top: 20px;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 14px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #00d9ff, #00ff88);
      color: #000;
      font-weight: 500;
    }
    .btn-primary:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }
    .btn-danger {
      background: rgba(255, 77, 77, 0.2);
      color: #ff4d4d;
      padding: 4px 10px;
      font-size: 12px;
    }
    .btn-danger:hover {
      background: rgba(255, 77, 77, 0.3);
    }
    .proxy-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .proxy-item:last-child {
      margin-bottom: 0;
    }
    .proxy-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .proxy-protocol {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
    }
    .proxy-protocol.http {
      background: rgba(0, 217, 255, 0.2);
      color: #00d9ff;
    }
    .proxy-protocol.websocket {
      background: rgba(255, 165, 0, 0.2);
      color: #ffa500;
    }
    .proxy-remote {
      color: #00d9ff;
      font-family: monospace;
    }
    .proxy-arrow {
      color: #666;
    }
    .proxy-local {
      color: #888;
      font-family: monospace;
    }
    .empty-state {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 14px;
    }
    .add-form {
      display: none;
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .add-form.show {
      display: block;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr) auto;
      gap: 12px;
      align-items: end;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
    }
    .form-group input, .form-group select {
      padding: 10px 14px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none;
      border-color: #00d9ff;
    }
    .form-actions {
      display: flex;
      gap: 8px;
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal.show {
      display: flex;
    }
    .modal-content {
      background: #1a1a2e;
      border-radius: 16px;
      padding: 30px;
      max-width: 400px;
      width: 90%;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .modal-title {
      font-size: 18px;
      margin-bottom: 20px;
      text-align: center;
    }
    .modal-actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }
    .modal-actions .btn {
      flex: 1;
    }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .btn-secondary:hover {
      background: rgba(255,255,255,0.15);
    }
    .last-update {
      text-align: center;
      color: #666;
      font-size: 12px;
      margin-top: 20px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      color: #666;
      font-size: 12px;
    }
    .footer a {
      color: #00d9ff;
      text-decoration: none;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    .toast.success {
      background: rgba(0, 255, 136, 0.2);
      color: #00ff88;
      border: 1px solid rgba(0, 255, 136, 0.3);
    }
    .toast.error {
      background: rgba(255, 77, 77, 0.2);
      color: #ff4d4d;
      border: 1px solid rgba(255, 77, 77, 0.3);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔌 feng3d-ctc 穿透客户端</h1>
      <div class="status running" id="status">运行中</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">服务器</div>
        <div class="card-value" id="server">-</div>
      </div>
      <div class="card">
        <div class="card-label">连接状态</div>
        <div class="card-value" id="connection">-</div>
      </div>
      <div class="card">
        <div class="card-label">运行时长</div>
        <div class="card-value"><span id="uptime">-</span></div>
      </div>
      <div class="card">
        <div class="card-label">代理数量</div>
        <div class="card-value"><span id="proxyCount">0</span><span class="unit"> 个</span></div>
      </div>
      <div class="card">
        <div class="card-label">重连次数</div>
        <div class="card-value"><span id="reconnectCount">0</span><span class="unit"> 次</span></div>
      </div>
    </div>

    <div class="proxies-section">
      <div class="section-header">
        <div class="section-title">代理映射</div>
        <button class="btn btn-primary" id="showAddForm">+ 添加代理</button>
      </div>

      <div class="add-form" id="addForm">
        <div class="form-row">
          <div class="form-group">
            <label>远程端口</label>
            <input type="number" id="newRemotePort" placeholder="8080" min="1" max="65535">
          </div>
          <div class="form-group">
            <label>协议</label>
            <select id="newProtocol">
              <option value="http">HTTP</option>
              <option value="websocket">WebSocket</option>
            </select>
          </div>
          <div class="form-group">
            <label>本地端口</label>
            <input type="number" id="newLocalPort" placeholder="3000" min="1" max="65535">
          </div>
          <div class="form-group">
            <label>本地地址</label>
            <input type="text" id="newLocalHost" placeholder="localhost">
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="addProxy">添加</button>
            <button class="btn btn-secondary" id="cancelAdd">取消</button>
          </div>
        </div>
      </div>

      <div id="proxiesList"></div>
    </div>

    <div class="last-update">最后更新: <span id="lastUpdate">-</span></div>

    <div class="footer">
      <a href="https://github.com/feng3d/chuantou" target="_blank">feng3d-ctc</a>
      — 内网穿透客户端
    </div>
  </div>

  <div class="modal" id="deleteModal">
    <div class="modal-content">
      <div class="modal-title">确认删除代理</div>
      <p style="color: #888; text-align: center;">确定要删除此代理映射吗？</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cancelDelete">取消</button>
        <button class="btn btn-danger" id="confirmDelete">删除</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let deletePort = null;

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

    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = \`toast \${type} show\`;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    async function updateStatus() {
      try {
        const res = await fetch('/_ctc/status');
        const data = await res.json();

        const statusEl = document.getElementById('status');
        if (data.running) {
          statusEl.textContent = data.authenticated ? '已连接' : (data.connected ? '认证中...' : '连接中...');
          statusEl.className = 'status running';
        } else {
          statusEl.textContent = '已停止';
          statusEl.className = 'status stopped';
        }

        document.getElementById('server').textContent = data.serverUrl.replace('ws://', '').replace('wss://', '');
        document.getElementById('connection').textContent = data.authenticated ? '已认证' : (data.connected ? '已连接' : '未连接');
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('proxyCount').textContent = data.proxies.length;
        document.getElementById('reconnectCount').textContent = data.reconnectAttempts;
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('zh-CN');

        // 更新代理列表
        const listEl = document.getElementById('proxiesList');
        if (data.proxies.length === 0) {
          listEl.innerHTML = '<div class="empty-state">暂无代理映射，点击上方按钮添加</div>';
        } else {
          listEl.innerHTML = data.proxies.map(p => {
            const protocol = p.protocol === 'websocket' ? 'websocket' : 'http';
            return \`
              <div class="proxy-item">
                <div class="proxy-info">
                  <span class="proxy-protocol \${protocol}">\${protocol === 'websocket' ? 'WS' : 'HTTP'}</span>
                  <span class="proxy-remote">:\${p.remotePort}</span>
                  <span class="proxy-arrow">→</span>
                  <span class="proxy-local">\${p.localHost || 'localhost'}:\${p.localPort}</span>
                </div>
                <button class="btn btn-danger" onclick="showDeleteModal(\${p.remotePort})">删除</button>
              </div>
            \`;
          }).join('');
        }
      } catch (e) {
        console.error('获取状态失败:', e);
      }
    }

    function showDeleteModal(port) {
      deletePort = port;
      document.getElementById('deleteModal').classList.add('show');
    }

    document.getElementById('cancelDelete').addEventListener('click', () => {
      document.getElementById('deleteModal').classList.remove('show');
      deletePort = null;
    });

    document.getElementById('confirmDelete').addEventListener('click', async () => {
      if (deletePort) {
        try {
          const res = await fetch(\`/_ctc/proxies/\${deletePort}\`, { method: 'DELETE' });
          if (res.ok) {
            showToast('代理已删除');
            updateStatus();
          } else {
            const data = await res.json();
            showToast(\`删除失败: \${data.error}\`, 'error');
          }
        } catch (e) {
          showToast('删除失败: 网络错误', 'error');
        }
      }
      document.getElementById('deleteModal').classList.remove('show');
      deletePort = null;
    });

    document.getElementById('showAddForm').addEventListener('click', () => {
      document.getElementById('addForm').classList.add('show');
    });

    document.getElementById('cancelAdd').addEventListener('click', () => {
      document.getElementById('addForm').classList.remove('show');
    });

    document.getElementById('addProxy').addEventListener('click', async () => {
      const remotePort = parseInt(document.getElementById('newRemotePort').value);
      const protocol = document.getElementById('newProtocol').value;
      const localPort = parseInt(document.getElementById('newLocalPort').value);
      const localHost = document.getElementById('newLocalHost').value || 'localhost';

      if (!remotePort || !localPort) {
        showToast('请填写完整信息', 'error');
        return;
      }

      try {
        const res = await fetch('/_ctc/proxies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remotePort, protocol, localPort, localHost })
        });

        if (res.ok) {
          showToast('代理已添加');
          document.getElementById('addForm').classList.remove('show');
          document.getElementById('newRemotePort').value = '';
          document.getElementById('newLocalPort').value = '';
          document.getElementById('newLocalHost').value = 'localhost';
          updateStatus();
        } else {
          const data = await res.json();
          showToast(\`添加失败: \${data.error}\`, 'error');
        }
      } catch (e) {
        showToast('添加失败: 网络错误', 'error');
      }
    });

    updateStatus();
    setInterval(updateStatus, 3000);
  </script>
</body>
</html>
`;

  /**
   * 创建管理服务器实例
   *
   * @param config - 服务器配置
   * @param getStatus - 获取状态的回调函数
   * @param addProxy - 添加代理的回调函数
   * @param removeProxy - 删除代理的回调函数
   */
  constructor(
    config: AdminServerConfig,
    getStatus: () => ClientStatus,
    addProxy: (proxy: ProxyConfig) => Promise<void>,
    removeProxy: (remotePort: number) => Promise<void>
  ) {
    this.port = config.port;
    this.host = config.host;
    this.startedAt = Date.now();
    this.getStatusCallback = getStatus;
    this.addProxyCallback = addProxy;
    this.removeProxyCallback = removeProxy;

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  /**
   * 启动服务器
   *
   * @returns 启动完成的 Promise
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        console.log(`管理页面已启动: http://${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('管理服务器错误:', error);
        reject(error);
      });
    });
  }

  /**
   * 处理 HTTP 请求
   *
   * 提供以下端点：
   * - `GET /` - 管理页面
   * - `GET /_ctc/status` - 获取状态
   * - `POST /_ctc/proxies` - 添加代理
   * - `DELETE /_ctc/proxies/:port` - 删除代理
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';

    // 管理页面
    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(AdminServer.STATUS_HTML);
      return;
    }

    // 状态 API
    if (url === '/_ctc/status' && req.method === 'GET') {
      const status = this.getStatusCallback();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // 添加代理 API
    if (url === '/_ctc/proxies' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const proxy = JSON.parse(body) as ProxyConfig;
          await this.addProxyCallback(proxy);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // 删除代理 API
    if (url.startsWith('/_ctc/proxies/') && req.method === 'DELETE') {
      const port = parseInt(url.split('/').pop()!, 10);
      if (isNaN(port)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无效的端口号' }));
        return;
      }

      this.removeProxyCallback(port)
        .then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        });
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server.close(() => {
        console.log('管理服务器已停止');
        resolve();
      });
    });
  }
}
