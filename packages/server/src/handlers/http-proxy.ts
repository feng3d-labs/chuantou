/**
 * @module http-proxy
 * @description HTTP 代理处理器模块，负责在指定端口上启动 HTTP 代理服务器。
 * 将外部 HTTP 请求转发给穿透客户端，并等待客户端返回响应数据后回复给请求方。
 */

import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage, HttpResponseData } from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';

/**
 * HTTP 代理处理器
 *
 * 管理多个 HTTP 代理服务器实例，每个代理监听一个独立端口。
 * 当外部请求到达代理端口时，将请求信息通过控制通道转发给对应的穿透客户端，
 * 等待客户端处理完成后将响应返回给请求方。
 */
export class HttpProxyHandler {
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** 代理服务器映射表，键为端口号，值为 HTTP 服务器实例 */
  private proxies: Map<number, HttpServer>;

  /**
   * 创建 HTTP 代理处理器实例
   *
   * @param sessionManager - 会话管理器，用于获取客户端连接和管理连接记录
   */
  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.proxies = new Map();
  }

  /**
   * 启动 HTTP 代理服务器
   *
   * 在指定端口创建并启动一个 HTTP 服务器，将该端口的所有请求转发给对应客户端。
   * 若该端口已存在代理或端口被占用，将抛出异常。
   *
   * @param port - 代理监听的端口号
   * @param clientId - 绑定的客户端唯一标识 ID
   * @returns 代理服务器启动完成的 Promise
   * @throws 端口已存在代理或端口被占用时抛出错误
   */
  async startProxy(port: number, clientId: string): Promise<void> {
    if (this.proxies.has(port)) {
      throw new Error(`端口 ${port} 的代理已存在`);
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
      console.error(`HTTP 代理在端口 ${port} 上发生错误:`, error);
    });

    return new Promise<void>((resolve, reject) => {
      server.listen(port, () => {
        console.log(`HTTP 代理正在端口 ${port} 上监听，绑定客户端 ${clientId}`);
        this.proxies.set(port, server);
        resolve();
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用`));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * 处理外部 HTTP 请求
   *
   * 将外部 HTTP 请求封装为消息发送给穿透客户端，等待客户端处理后返回响应。
   * 流程包括：记录连接、构建请求头、读取请求体、发送到客户端、等待响应、回复请求方。
   *
   * @param clientId - 处理该请求的客户端唯一标识 ID
   * @param req - 收到的 HTTP 请求对象
   * @param res - 用于发送响应的 HTTP 响应对象
   */
  private async handleRequest(clientId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('网关错误：客户端未连接');
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, req.socket.remoteAddress || '', 'http');

    console.log(`HTTP 请求: ${req.method} ${req.url} -> 客户端 ${clientId} (${connectionId})`);

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

      console.log(`HTTP 响应: ${response.statusCode}，连接 ${connectionId}`);
    } catch (error) {
      console.error(`处理 HTTP 请求 ${connectionId} 时出错:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('服务器内部错误');
      }
    } finally {
      // 清理连接
      this.sessionManager.removeConnection(connectionId);
      this.pendingResponses.delete(connectionId);
    }
  }

  /**
   * 待处理响应映射表
   *
   * 存储等待客户端响应的 Promise 回调和超时定时器，键为连接 ID。
   */
  private pendingResponses: Map<string, {
    /** 响应成功时的 Promise resolve 回调 */
    resolve: (value: HttpResponseData) => void;
    /** 响应失败时的 Promise reject 回调 */
    reject: (error: Error) => void;
    /** 响应超时定时器 */
    timeout: NodeJS.Timeout;
  }> = new Map();

  /**
   * 等待客户端响应
   *
   * 创建一个 Promise，等待穿透客户端处理完请求并返回响应数据。
   * 若超过 30 秒未收到响应，将自动超时并拒绝 Promise。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param clientId - 客户端唯一标识 ID
   * @returns 客户端返回的 HTTP 响应数据
   */
  private waitForResponse(connectionId: string, clientId: string): Promise<HttpResponseData> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(connectionId);
        reject(new Error('响应超时'));
      }, 30000); // 30秒超时

      this.pendingResponses.set(connectionId, { resolve, reject, timeout });
    });
  }

  /**
   * 处理穿透客户端返回的响应数据
   *
   * 接收客户端处理完请求后返回的 HTTP 响应数据，清除超时定时器并解析对应的待处理 Promise。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 客户端返回的 HTTP 响应数据
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
   * 读取 HTTP 请求体
   *
   * 从 IncomingMessage 流中读取完整的请求体数据。
   *
   * @param req - HTTP 请求对象
   * @returns 包含完整请求体的 Buffer
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
   * 停止指定端口的 HTTP 代理服务器
   *
   * 关闭指定端口上的 HTTP 代理服务器并从映射表中移除。
   *
   * @param port - 需要停止的代理端口号
   * @returns 代理服务器关闭完成的 Promise
   */
  async stopProxy(port: number): Promise<void> {
    const server = this.proxies.get(port);
    if (server) {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log(`HTTP 代理已在端口 ${port} 上停止`);
          this.proxies.delete(port);
          resolve();
        });
      });
    }
  }

  /**
   * 停止所有 HTTP 代理服务器
   *
   * 并行关闭所有已启动的 HTTP 代理服务器。
   *
   * @returns 所有代理服务器关闭完成的 Promise
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const [port] of this.proxies) {
      stopPromises.push(this.stopProxy(port));
    }
    await Promise.all(stopPromises);
  }

  /**
   * 获取所有活跃代理的端口列表
   *
   * @returns 当前正在运行的所有 HTTP 代理端口号数组
   */
  getActivePorts(): number[] {
    return Array.from(this.proxies.keys());
  }
}
