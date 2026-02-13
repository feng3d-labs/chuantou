/**
 * @module admin-server
 * @description 客户端管理页面 HTTP 服务器模块。
 * 提供一个本地 HTTP 服务，用于查看客户端状态和管理代理映射。
 * 支持反向代理模式和正向穿透模式。
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFile } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProxyConfig, ForwardProxyEntry } from '@feng3d/chuantou-shared';

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
  /** 正向穿透代理列表 */
  forwardProxies?: Array<{ localPort: number; targetClientId: string; targetPort: number }>;
  /** 客户端是否已注册到服务器（正向穿透模式） */
  isRegistered?: boolean;
  /** 当前客户端ID */
  clientId?: string;
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
  /** 正向穿透代理列表（用于存储运行时的正向穿透配置） */
  private forwardProxies: Map<string, { localPort: number; targetClientId: string; targetPort: number }> = new Map();
  /** 发送消息到服务端的回调（用于正向穿透操作） */
  private sendMessageCallback?: (message: any) => Promise<any>;
  /** 触发重连的回调函数 */
  private reconnectCallback?: () => Promise<void>;
  /** 添加正向穿透代理回调函数 */
  private addForwardProxyCallback?: (entry: ForwardProxyEntry) => Promise<void>;
  /** 删除正向穿透代理回调函数 */
  private removeForwardProxyCallback?: (localPort: number) => Promise<void>;
  /** 注册客户端回调函数 */
  private registerClientCallback?: (description?: string) => Promise<void>;
  /** 获取客户端列表回调函数 */
  private getClientListCallback?: () => Promise<any>;

  /**
   * 静态文件路径常量
   */
  private static readonly STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'admin-ui', 'dist');

  /**
   * HTML 模板文件路径
   */
  private static readonly TEMPLATE_PATH = join(AdminServer.STATIC_DIR, 'template.html');

  /**
   * 创建管理服务器实例
   *
   * @param config - 服务器配置
   * @param getStatus - 获取状态的回调函数
   * @param addProxy - 添加反向代理的回调函数
   * @param removeProxy - 删除反向代理的回调函数
   * @param addForwardProxy - 添加正向穿透的回调函数
   * @param removeForwardProxy - 删除正向穿透的回调函数
   * @param registerClient - 注册客户端的回调函数
   * @param getClientList - 获取客户端列表的回调函数
   * @param reconnect - 触发重连的回调函数
   */
  constructor(
    config: AdminServerConfig,
    getStatus: () => ClientStatus,
    addProxy: (proxy: ProxyConfig) => Promise<void>,
    removeProxy: (remotePort: number) => Promise<void>,
    addForwardProxy?: (entry: ForwardProxyEntry) => Promise<void>,
    removeForwardProxy?: (localPort: number) => Promise<void>,
    registerClient?: (description?: string) => Promise<void>,
    getClientList?: () => Promise<any>,
    sendMessage?: (message: any) => Promise<any>,
    reconnect?: () => Promise<void>
  ) {
    this.port = config.port;
    this.host = config.host;
    this.startedAt = Date.now();
    this.getStatusCallback = getStatus;
    this.addProxyCallback = addProxy;
    this.removeProxyCallback = removeProxy;
    this.addForwardProxyCallback = addForwardProxy;
    this.removeForwardProxyCallback = removeForwardProxy;
    this.registerClientCallback = registerClient;
    this.getClientListCallback = getClientList;
    this.sendMessageCallback = sendMessage;
    this.reconnectCallback = reconnect;

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  /**
   * 设置发送消息的回调
   */
  setSendMessageCallback(callback: (message: any) => Promise<any>): void {
    this.sendMessageCallback = callback;
  }

  /**
   * 设置重连回调
   */
  setReconnectCallback(callback: () => Promise<void>): void {
    this.reconnectCallback = callback;
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
   * 反向代理：
   *   - `GET /` - 管理页面
   *   - `GET /_ctc/status` - 获取状态
   *   - `POST /_ctc/proxies` - 添加反向代理
   *   - `DELETE /_ctc/proxies/:port` - 删除反向代理
   * 正向穿透：
   *   - `GET /_ctc/forward/list` - 获取正向穿透列表
   *   - `POST /_ctc/forward/add` - 添加正向穿透
   *   - `POST /_ctc/forward/remove` - 删除正向穿透
   *   - `GET /_ctc/forward/clients` - 获取客户端列表
   *   - `POST /_ctc/forward/register` - 注册到服务器
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // 静态文件服务 - 首页读取模板文件
    if (url === '/' && req.method === 'GET') {
      readFile(AdminServer.TEMPLATE_PATH, 'utf-8', (err, data) => {
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

    // 处理静态文件请求 (支持 .js, .css 等静态资源直接从根路径访问)
    if (req.method === 'GET' && url !== '/' && !url.startsWith('/_ctc/')) {
      const fileName = url.slice(1) as string; // 去掉开头的 /
      const filePath = join(AdminServer.STATIC_DIR, fileName);

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

    // 状态 API
    if (url === '/_ctc/status' && req.method === 'GET') {
      const status = this.getStatusCallback();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // ==================== 反向代理 API ====================

    // 添加反向代理 API
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

    // 删除反向代理 API
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

    // ==================== 正向穿透 API ====================

    // forward list - 列出正向穿透代理
    if (url === '/_ctc/forward/list' && req.method === 'GET') {
      const proxies = Array.from(this.forwardProxies.entries()).map(([key, value]) => ({
        localPort: value.localPort,
        targetClientId: value.targetClientId,
        targetPort: value.targetPort,
        enabled: true,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proxies }));
      return;
    }

    // forward add - 添加正向穿透代理
    if (url === '/_ctc/forward/add' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body) as { localPort: number; targetClientId: string; targetPort: number };
          const key = `${data.localPort}`;

          if (this.addForwardProxyCallback) {
            await this.addForwardProxyCallback({
              ...data,
              enabled: true,
            });
          }

          this.forwardProxies.set(key, {
            localPort: data.localPort,
            targetClientId: data.targetClientId,
            targetPort: data.targetPort,
          });

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

    // forward remove - 移除正向穿透代理
    if (url === '/_ctc/forward/remove' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body) as { localPort: number };
          const key = `${data.localPort}`;
          const deleted = this.forwardProxies.delete(key);

          if (this.removeForwardProxyCallback) {
            await this.removeForwardProxyCallback(data.localPort);
          }

          if (deleted) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '代理不存在' }));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // forward clients - 获取客户端列表
    if (url === '/_ctc/forward/clients' && req.method === 'GET') {
      if (!this.getClientListCallback) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '服务未就绪' }));
        return;
      }

      try {
        const result = await this.getClientListCallback();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMessage }));
      }
      return;
    }

    // forward register - 注册到服务器
    if (url === '/_ctc/forward/register' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body) as { description?: string };
          if (!this.registerClientCallback) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '服务未就绪' }));
            return;
          }

          const result = await this.registerClientCallback(data.description);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // reconnect - 主动重连到服务器
    if (url === '/_ctc/reconnect' && req.method === 'POST') {
      if (!this.reconnectCallback) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '重连服务未就绪' }));
        return;
      }

      try {
        await this.reconnectCallback();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '正在重连...' }));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMessage }));
      }
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
