/**
 * @module unified-proxy
 * @description 统一代理处理器模块，在指定端口上同时支持 HTTP 和 WebSocket 代理。
 * 将外部 HTTP/WebSocket 请求转发给穿透客户端，实现双向数据转发。
 */

import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage, HttpResponseData, logger } from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';

/**
 * 统一代理处理器
 *
 * 管理多个代理服务器实例，每个代理监听一个独立端口，
 * 同时支持 HTTP 请求和 WebSocket 升级请求。
 * 当外部请求到达代理端口时，将请求信息通过控制通道转发给对应的穿透客户端。
 */
export class UnifiedProxyHandler {
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** 代理服务器映射表，键为端口号，值为 HTTP 服务器实例 */
  private proxies: Map<number, HttpServer>;
  /** WebSocket 服务器映射表，用于处理 upgrade 事件 */
  private wsServers: Map<number, WebSocketServer>;

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
   * 用户 WebSocket 连接映射表
   *
   * 存储外部用户的 WebSocket 连接，键为连接 ID，值为用户的 WebSocket 实例。
   */
  private userConnections: Map<string, WebSocket> = new Map();

  /**
   * 创建统一代理处理器实例
   *
   * @param sessionManager - 会话管理器，用于获取客户端连接和管理连接记录
   */
  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.proxies = new Map();
    this.wsServers = new Map();
  }

  /**
   * 启动代理服务器
   *
   * 在指定端口创建并启动一个 HTTP 服务器，该端口同时支持 HTTP 请求和 WebSocket 升级。
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

    // 处理 HTTP 请求
    server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
      await this.handleHttpRequest(clientId, req, res);
    });

    // 处理 WebSocket 升级请求
    server.on('upgrade', async (req: IncomingMessage, socket: any, head: Buffer) => {
      await this.handleWebSocketUpgrade(clientId, req, socket, head);
    });

    server.on('error', (error) => {
      logger.error(`代理在端口 ${port} 上发生错误:`, error);
    });

    return new Promise<void>((resolve, reject) => {
      server.listen(port, () => {
        logger.log(`代理正在端口 ${port} 上监听（HTTP + WebSocket），绑定客户端 ${clientId}`);
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
   *
   * @param clientId - 处理该请求的客户端唯一标识 ID
   * @param req - 收到的 HTTP 请求对象
   * @param res - 用于发送响应的 HTTP 响应对象
   */
  private async handleHttpRequest(clientId: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('网关错误：客户端未连接');
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, req.socket.remoteAddress || '', 'http');

    logger.log(`HTTP 请求: ${req.method} ${req.url} -> 客户端 ${clientId} (${connectionId})`);

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
        const bodyBuffer = Buffer.isBuffer(response.body)
          ? response.body
          : Buffer.from(response.body, 'base64');
        res.end(bodyBuffer);
      } else {
        res.end();
      }

      logger.log(`HTTP 响应: ${response.statusCode}，连接 ${connectionId}`);
    } catch (error) {
      logger.error(`处理 HTTP 请求 ${connectionId} 时出错:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('服务器内部错误');
      }
    } finally {
      // 清理连接
      this.sessionManager.removeConnection(connectionId);
      this.pendingResponses.delete(connectionId);
    }
  }

  /**
   * 处理 WebSocket 升级请求
   *
   * 将外部 WebSocket 连接桥接到穿透客户端，实现双向实时数据转发。
   *
   * @param clientId - 处理该连接的客户端唯一标识 ID
   * @param req - HTTP 升级请求对象
   * @param socket - 底层 socket 连接
   * @param head - 升级请求的头部 buffer
   */
  private async handleWebSocketUpgrade(clientId: string, req: IncomingMessage, socket: any, head: Buffer): Promise<void> {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, req.socket.remoteAddress || '', 'websocket');

    logger.log(`WebSocket 升级: ${req.url} -> 客户端 ${clientId} (${connectionId})`);

    // 构建 WebSocket 服务器处理此连接
    const wsServer = new WebSocketServer({ noServer: true });

    wsServer.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      this.handleWebSocketConnection(clientId, connectionId, ws, req);
    });
  }

  /**
   * 处理 WebSocket 连接
   *
   * 当外部用户连接到代理端口时，记录连接信息，通知穿透客户端有新连接到来，
   * 并设置消息转发、关闭和错误的事件处理。
   *
   * @param clientId - 处理该连接的客户端唯一标识 ID
   * @param connectionId - 连接唯一标识 ID
   * @param userWs - 外部用户的 WebSocket 连接
   * @param req - HTTP 升级请求对象
   */
  private handleWebSocketConnection(clientId: string, connectionId: string, userWs: WebSocket, req: IncomingMessage): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      userWs.close(1011, '客户端未连接');
      return;
    }

    logger.log(`WebSocket 连接已建立: ${req.url} (${connectionId})`);

    // 存储用户 WebSocket 引用
    this.userConnections.set(connectionId, userWs);

    // 构建请求头
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(', ') : (value as string);
      }
    }

    // 发送新连接消息给客户端
    const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
      connectionId,
      protocol: 'websocket',
      url: req.url || '/',
      wsHeaders: headers,
    });

    clientSocket.send(JSON.stringify(newConnMsg));

    // 处理来自用户的消息
    userWs.on('message', (data: Buffer) => {
      this.forwardToClient(clientId, connectionId, data);
    });

    // 处理来自用户关闭
    userWs.on('close', (code: number, reason: Buffer) => {
      logger.log(`用户 WebSocket 已关闭: ${connectionId} (${code})`);
      this.notifyClientClose(clientId, connectionId, code);
      this.cleanupConnection(connectionId);
    });

    // 处理错误
    userWs.on('error', (error) => {
      logger.error(`用户 WebSocket 错误 ${connectionId}:`, error);
      this.cleanupConnection(connectionId);
    });
  }

  /**
   * 将用户消息转发到穿透客户端
   *
   * 将外部用户发送的 WebSocket 数据编码为 Base64 后，通过控制通道发送给穿透客户端。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 连接唯一标识 ID
   * @param data - 用户发送的原始数据
   */
  private forwardToClient(clientId: string, connectionId: string, data: Buffer): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(JSON.stringify({
        type: 'connection_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 通知穿透客户端连接已关闭
   *
   * 当外部用户的 WebSocket 连接关闭时，向穿透客户端发送连接关闭通知消息。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 已关闭的连接唯一标识 ID
   * @param code - WebSocket 关闭状态码
   */
  private notifyClientClose(clientId: string, connectionId: string, code: number): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      const closeMsg: ConnectionCloseMessage = createMessage(MessageType.CONNECTION_CLOSE, {
        connectionId,
      });
      clientSocket.send(JSON.stringify(closeMsg));
    }
  }

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
   * 处理穿透客户端返回的响应数据
   *
   * 接收客户端处理完请求后返回的 HTTP 响应数据，清除超时定时器并解析对应的待处理 Promise。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 客户端返回的原始响应消息对象，包含 statusCode, headers, body 等字段
   */
  handleClientResponse(connectionId: string, data: any): void {
    const pending = this.pendingResponses.get(connectionId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingResponses.delete(connectionId);
      // 提取需要的响应字段
      const responseData: HttpResponseData = {
        statusCode: data.statusCode || 200,
        headers: data.headers || {},
        body: data.body,
      };
      pending.resolve(responseData);
    }
  }

  /**
   * 处理来自穿透客户端的数据
   *
   * 将穿透客户端发送的数据转发给对应的外部用户 WebSocket 连接。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 穿透客户端发送的数据
   */
  handleClientData(connectionId: string, data: Buffer): void {
    const userWs = this.userConnections.get(connectionId);
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      userWs.send(data);
    }
  }

  /**
   * 处理来自穿透客户端的关闭请求
   *
   * 当穿透客户端请求关闭某个连接时，关闭对应的外部用户 WebSocket 连接并清理资源。
   *
   * @param connectionId - 需要关闭的连接唯一标识 ID
   * @param code - 可选的 WebSocket 关闭状态码，默认为 1000（正常关闭）
   */
  handleClientClose(connectionId: string, code?: number): void {
    const userWs = this.userConnections.get(connectionId);
    if (userWs) {
      userWs.close(code || 1000);
    }
    this.cleanupConnection(connectionId);
  }

  /**
   * 清理连接资源
   *
   * 从用户连接映射表和会话管理器中移除指定连接的记录。
   *
   * @param connectionId - 需要清理的连接唯一标识 ID
   */
  private cleanupConnection(connectionId: string): void {
    this.userConnections.delete(connectionId);
    this.sessionManager.removeConnection(connectionId);
  }

  /**
   * 停止指定端口的代理服务器
   *
   * 关闭指定端口上的代理服务器并从映射表中移除。
   *
   * @param port - 需要停止的代理端口号
   * @returns 代理服务器关闭完成的 Promise
   */
  async stopProxy(port: number): Promise<void> {
    const server = this.proxies.get(port);
    if (server) {
      return new Promise<void>((resolve) => {
        server.close(() => {
          logger.log(`代理已在端口 ${port} 上停止`);
          this.proxies.delete(port);
          resolve();
        });
      });
    }
  }

  /**
   * 停止所有代理服务器
   *
   * 并行关闭所有已启动的代理服务器。
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
   * @returns 当前正在运行的所有代理端口号数组
   */
  getActivePorts(): number[] {
    return Array.from(this.proxies.keys());
  }
}
