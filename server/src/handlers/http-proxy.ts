import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage, HttpResponseData } from '@zhuanfa/shared';
import { SessionManager } from '../session-manager.js';

/**
 * HTTP代理处理器
 */
export class HttpProxyHandler {
  private sessionManager: SessionManager;
  private proxies: Map<number, HttpServer>;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.proxies = new Map();
  }

  /**
   * 启动HTTP代理
   */
  async startProxy(port: number, clientId: string): Promise<void> {
    if (this.proxies.has(port)) {
      throw new Error(`Proxy already exists for port ${port}`);
    }

    const server = new HttpServer();

    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      await this.handleRequest(clientId, req, res);
    });

    server.on('upgrade', async (req: IncomingMessage, socket: any, head: Buffer) => {
      // WebSocket升级请求，交给WS代理处理
      // 这里暂时不处理，由WS代理处理器处理
      socket.destroy();
    });

    server.on('error', (error) => {
      console.error(`HTTP proxy error on port ${port}:`, error);
    });

    return new Promise<void>((resolve, reject) => {
      server.listen(port, () => {
        console.log(`HTTP proxy listening on port ${port} for client ${clientId}`);
        this.proxies.set(port, server);
        resolve();
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${port} is already in use`));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * 处理HTTP请求
   */
  private async handleRequest(clientId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Bad Gateway: Client not connected');
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, req.socket.remoteAddress || '', 'http');

    console.log(`HTTP request: ${req.method} ${req.url} -> client ${clientId} (${connectionId})`);

    try {
      // 构建请求头
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headers[key] = Array.isArray(value) ? value.join(', ') : value;
        }
      }

      // 读取请求体
      let body: Buffer | undefined;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await this.readRequestBody(req);
      }

      // 发送新连接消息给客户端
      const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
        connectionId,
        protocol: 'http',
        method: req.method,
        url: req.url || '/',
        headers,
        body: body?.toString('base64'),
      });

      clientSocket.send(JSON.stringify(newConnMsg));

      // 等待客户端响应
      const response = await this.waitForResponse(connectionId, clientId);

      // 发送响应给用户
      res.writeHead(response.statusCode, response.headers);
      if (response.body) {
        // 支持base64编码的响应体
        const bodyBuffer = Buffer.isBuffer(response.body)
          ? response.body
          : Buffer.from(response.body, 'base64');
        res.end(bodyBuffer);
      } else {
        res.end();
      }

      console.log(`HTTP response: ${response.statusCode} for ${connectionId}`);
    } catch (error) {
      console.error(`Error handling HTTP request ${connectionId}:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      }
    } finally {
      // 清理连接
      this.sessionManager.removeConnection(connectionId);
      this.pendingResponses.delete(connectionId);
    }
  }

  /**
   * 等待客户端响应
   */
  private pendingResponses: Map<string, {
    resolve: (value: HttpResponseData) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  private waitForResponse(connectionId: string, clientId: string): Promise<HttpResponseData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(connectionId);
        reject(new Error('Response timeout'));
      }, 30000); // 30秒超时

      this.pendingResponses.set(connectionId, { resolve, reject, timeout });
    });
  }

  /**
   * 处理客户端的响应数据
   */
  handleClientResponse(connectionId: string, data: HttpResponseData): void {
    const pending = this.pendingResponses.get(connectionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(connectionId);
      pending.resolve(data);
    }
  }

  /**
   * 读取请求体
   */
  private readRequestBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      req.on('error', reject);
    });
  }

  /**
   * 停止HTTP代理
   */
  async stopProxy(port: number): Promise<void> {
    const server = this.proxies.get(port);
    if (server) {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log(`HTTP proxy stopped on port ${port}`);
          this.proxies.delete(port);
          resolve();
        });
      });
    }
  }

  /**
   * 停止所有代理
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const [port] of this.proxies) {
      stopPromises.push(this.stopProxy(port));
    }
    await Promise.all(stopPromises);
  }

  /**
   * 获取活跃代理端口列表
   */
  getActivePorts(): number[] {
    return Array.from(this.proxies.keys());
  }
}
