/**
 * @module unified-proxy
 * @description 统一代理处理器模块，在指定端口上同时支持 HTTP、WebSocket 和 TCP 代理。
 * 将外部 HTTP/WebSocket/TCP 请求转发给穿透客户端，实现双向数据转发。
 */

import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http';
import { Server as TcpServer, Socket, createServer } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage, HttpResponseData, logger } from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';

/**
 * 代理服务器实例
 *
 * 封装了同一端口上的 HTTP 服务器和 TCP 服务器。
 */
interface ProxyServerInstance {
  /** HTTP 服务器（处理 HTTP 和 WebSocket） */
  httpServer: HttpServer;
  /** TCP 服务器（处理原始 TCP 连接） */
  tcpServer: TcpServer;
  /** 端口号 */
  port: number;
}

/**
 * 统一代理处理器
 *
 * 管理多个代理服务器实例，每个代理监听一个独立端口，
 * 同时支持 HTTP 请求、WebSocket 升级请求和原始 TCP 连接。
 * 当外部请求到达代理端口时，将请求信息通过控制通道转发给对应的穿透客户端。
 */
export class UnifiedProxyHandler {
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** 代理服务器映射表，键为端口号，值为代理服务器实例 */
  private proxies: Map<number, ProxyServerInstance>;

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
   * 流式 HTTP 响应映射表
   *
   * 存储正在进行的流式响应（如 SSE）的响应对象。
   */
  private streamingResponses: Map<string, ServerResponse> = new Map();

  /**
   * 用户 TCP 连接映射表
   *
   * 存储外部用户的 TCP socket 连接，键为连接 ID，值为用户的 Socket 实例。
   */
  private userTcpSockets: Map<string, Socket> = new Map();

  /**
   * 创建统一代理处理器实例
   *
   * @param sessionManager - 会话管理器，用于获取客户端连接和管理连接记录
   */
  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.proxies = new Map();
  }

  /**
   * 启动代理服务器
   *
   * 在指定端口创建并启动一个统一代理服务器。
   * 该端口同时支持 HTTP 请求、WebSocket 升级和原始 TCP 连接。
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

    // 使用原始 TCP 服务器监听端口，然后协议检测
    const tcpServer = createServer({ pauseOnConnect: true });

    tcpServer.on('connection', (socket: Socket) => {
      // 使用 pauseOnConnect: true 后，socket 已经被暂停
      // 我们需要监听 readable 事件而不是 data 事件，因为暂停的 socket 不会触发 data
      socket.once('readable', () => {
        // 读取前几个字节来检测协议
        const data = socket.read(Math.min(socket.readableLength || 1024, 1024)) as Buffer;
        if (!data) {
          // 没有数据可读，等待 data 事件
          socket.once('data', (data: Buffer) => {
            const isHttp = this.detectHttpProtocol(data);
            if (isHttp) {
              this.emitToHttpServer(clientId, port, socket, data);
            } else {
              this.handleTcpConnection(clientId, port, socket, data);
            }
          });
          socket.resume();
          return;
        }

        const isHttp = this.detectHttpProtocol(data);

        if (isHttp) {
          // 是 HTTP/WebSocket 连接，使用 HTTP 服务器处理
          this.emitToHttpServer(clientId, port, socket, data);
        } else {
          // 是纯 TCP 连接（如 SSH）
          this.handleTcpConnection(clientId, port, socket, data);
        }
      });
    });

    tcpServer.on('error', (error) => {
      logger.error(`代理在端口 ${port} 上发生错误:`, error);
    });

    return new Promise<void>((resolve, reject) => {
      tcpServer.listen(port, () => {
        logger.log(`代理正在端口 ${port} 上监听（HTTP + WebSocket + TCP），绑定客户端 ${clientId}`);
        this.proxies.set(port, { httpServer: null as any, tcpServer, port });
        resolve();
      });

      tcpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用`));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * 检测连接是否为 HTTP 协议
   *
   * 通过检查数据的前几个字节判断是否为 HTTP 请求。
   * HTTP 请求通常以 GET、POST、PUT、DELETE、HEAD、OPTIONS、PATCH、TRACE 等方法开头。
   *
   * @param data - 连接的初始数据
   * @returns 是否为 HTTP 协议
   */
  private detectHttpProtocol(data: Buffer): boolean {
    if (data.length < 4) return false;

    const header = data.toString('ascii', 0, Math.min(data.length, 8)).toUpperCase();

    // 检查是否为 HTTP 方法
    const httpMethods = ['GET', 'POST', 'PUT', 'DELET', 'HEAD', 'OPTIO', 'PATCH', 'TRACE', 'CONN'];
    for (const method of httpMethods) {
      if (header.startsWith(method)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 将 socket 和数据转发到 HTTP 服务器处理
   *
   * 由于我们不能直接将 TCP socket 转换为 HTTP socket，
   * 这里采用另一种方式：动态创建一个 HTTP 请求处理器。
   *
   * @param clientId - 客户端 ID
   * @param port - 端口号
   * @param socket - 原始 TCP socket
   * @param initialData - 初始数据
   */
  private emitToHttpServer(clientId: string, port: number, socket: Socket, initialData: Buffer): void {
    // 恢复 socket
    socket.resume();

    // 创建一个简单的 HTTP 解析器来处理请求
    let requestData = initialData;
    let headersParsed = false;
    let headers: Record<string, string> = {};
    let method = 'GET';
    let url = '/';
    let contentLength = 0;
    let bodyRemaining = 0;
    let bodyChunks: Buffer[] = [];

    const parseHeaders = () => {
      const headerEnd = requestData.indexOf('\r\n\r\n');
      if (headerEnd === -1) return false;

      const headerSection = requestData.toString('utf-8', 0, headerEnd);
      const lines = headerSection.split('\r\n');

      // 解析请求行
      const requestLine = lines[0].split(' ');
      if (requestLine.length >= 2) {
        method = requestLine[0];
        url = requestLine[1];
      }

      // 解析头部
      for (let i = 1; i < lines.length; i++) {
        const colonPos = lines[i].indexOf(':');
        if (colonPos > 0) {
          const key = lines[i].substring(0, colonPos).toLowerCase().trim();
          const value = lines[i].substring(colonPos + 1).trim();
          headers[key] = value;

          if (key === 'content-length') {
            contentLength = parseInt(value, 10);
            bodyRemaining = contentLength;
          }
        }
      }

      // 检查是否为 WebSocket 升级请求
      const isUpgrade = headers['upgrade']?.toLowerCase() === 'websocket';

      headersParsed = true;

      // 处理请求体
      const bodyStart = headerEnd + 4;
      if (bodyStart < requestData.length) {
        const bodyData = requestData.slice(bodyStart);
        bodyRemaining -= bodyData.length;
        bodyChunks.push(bodyData);
      }

      // 根据类型分发处理
      if (isUpgrade) {
        // WebSocket 连接 - 需要特殊处理
        this.handleWebSocketOnRawSocket(clientId, socket, { method, url, headers });
      } else {
        // 普通 HTTP 请求
        this.handleHttpRequestOnRawSocket(clientId, socket, { method, url, headers, bodyChunks, bodyRemaining });
      }

      return true;
    };

    socket.on('data', (data: Buffer) => {
      if (!headersParsed) {
        requestData = Buffer.concat([requestData, data]);
        if (!parseHeaders()) {
          // 头部还没收完，继续等待
        }
      } else if (bodyRemaining > 0) {
        bodyChunks.push(data);
        bodyRemaining -= data.length;
        if (bodyRemaining <= 0) {
          // 请求体收全了
        }
      }
    });

    // 尝试解析已有数据
    parseHeaders();
  }

  /**
   * 在原始 socket 上处理 HTTP 请求
   */
  private async handleHttpRequestOnRawSocket(
    clientId: string,
    socket: Socket,
    request: { method: string; url: string; headers: Record<string, string>; bodyChunks: Buffer[]; bodyRemaining: number }
  ): Promise<void> {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, socket.remoteAddress || '', 'http');

    logger.log(`HTTP 请求: ${request.method} ${request.url} -> 客户端 ${clientId} (${connectionId})`);

    try {
      const body = Buffer.concat(request.bodyChunks);

      // 发送新连接消息给客户端
      const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
        connectionId,
        protocol: 'http',
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: body.length > 0 ? body.toString('base64') : undefined,
      });

      clientSocket.send(JSON.stringify(newConnMsg));

      // 等待客户端响应
      const response = await this.waitForResponse(connectionId, clientId);

      // 发送响应
      const headerLines = ['HTTP/1.1 ' + response.statusCode];
      for (const [key, value] of Object.entries(response.headers)) {
        headerLines.push(`${key}: ${value}`);
      }
      headerLines.push('\r\n');

      socket.write(Buffer.from(headerLines.join('\r\n')));

      if (response.body) {
        const bodyBuffer = Buffer.isBuffer(response.body)
          ? response.body
          : Buffer.from(response.body, 'base64');
        socket.write(bodyBuffer);
      }

      socket.end();

      logger.log(`HTTP 响应: ${response.statusCode}，连接 ${connectionId}`);

      // 清理连接
      this.sessionManager.removeConnection(connectionId);
    } catch (error) {
      logger.error(`处理 HTTP 请求 ${connectionId} 时出错:`, error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
      this.sessionManager.removeConnection(connectionId);
    }
  }

  /**
   * 在原始 socket 上处理 WebSocket 升级
   * 注意：这是一个简化的实现，完整的 WebSocket 握手处理较复杂
   */
  private handleWebSocketOnRawSocket(
    clientId: string,
    socket: Socket,
    request: { method: string; url: string; headers: Record<string, string> }
  ): void {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      socket.destroy();
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, socket.remoteAddress || '', 'websocket');

    logger.log(`WebSocket 升级: ${request.url} -> 客户端 ${clientId} (${connectionId})`);

    // 发送新连接消息给客户端
    const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
      connectionId,
      protocol: 'websocket',
      url: request.url,
      wsHeaders: request.headers,
    });

    clientSocket.send(JSON.stringify(newConnMsg));

    // 存储 socket 以便后续数据转发
    this.userConnections.set(connectionId, socket as any);

    // 处理来自用户的数据
    socket.on('data', (data: Buffer) => {
      // 转发给客户端（已经是 WebSocket 帧格式）
      this.forwardToClient(clientId, connectionId, data);
    });

    socket.on('close', () => {
      logger.log(`用户 WebSocket 已关闭: ${connectionId}`);
      this.notifyClientClose(clientId, connectionId, 1000);
      this.cleanupConnection(connectionId);
    });

    socket.on('error', (error) => {
      logger.error(`用户 WebSocket 错误 ${connectionId}:`, error);
      this.cleanupConnection(connectionId);
    });
  }

  /**
   * 处理外部 HTTP 请求
   *
   * 将外部 HTTP 请求封装为消息发送给穿透客户端，等待客户端处理后返回响应。
   * 支持流式响应（如 SSE）和普通 HTTP 响应。
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

      // 等待客户端响应头（第一个消息）
      const firstResponse = await this.waitForResponse(connectionId, clientId);

      // 检查是否为流式响应（仅根据 Content-Type 判断）
      const contentType = String(firstResponse.headers['content-type'] || '').toLowerCase();
      const isStreaming = contentType.includes('text/event-stream') ||
                         contentType.includes('stream');

      if (isStreaming) {
        // 流式响应模式（SSE）
        logger.log(`HTTP 流式响应: ${req.url} (${connectionId})`);
        this.streamingResponses.set(connectionId, res);

        // 发送响应头
        res.writeHead(firstResponse.statusCode, firstResponse.headers);
        res.flushHeaders();

        // 如果有初始 body，先发送
        if (firstResponse.body) {
          const bodyBuffer = Buffer.isBuffer(firstResponse.body)
            ? firstResponse.body
            : Buffer.from(firstResponse.body, 'base64');
          res.write(bodyBuffer);
        }

        // 等待流结束，不清理连接（由流结束事件处理）
        this.pendingResponses.delete(connectionId);
      } else {
        // 普通 HTTP 响应模式
        res.writeHead(firstResponse.statusCode, firstResponse.headers);
        if (firstResponse.body) {
          const bodyBuffer = Buffer.isBuffer(firstResponse.body)
            ? firstResponse.body
            : Buffer.from(firstResponse.body, 'base64');
          res.end(bodyBuffer);
        } else {
          res.end();
        }

        logger.log(`HTTP 响应: ${firstResponse.statusCode}，连接 ${connectionId}`);

        // 清理连接
        this.sessionManager.removeConnection(connectionId);
        this.pendingResponses.delete(connectionId);
      }
    } catch (error) {
      logger.error(`处理 HTTP 请求 ${connectionId} 时出错:`, error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('服务器内部错误');
      }
      // 清理连接
      this.sessionManager.removeConnection(connectionId);
      this.pendingResponses.delete(connectionId);
      this.streamingResponses.delete(connectionId);
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
   * 处理原始 TCP 连接（非 HTTP/WebSocket）
   *
   * 当外部用户通过原始 TCP 连接（如 SSH 客户端）连接到代理端口时，
   * 记录连接信息，通知穿透客户端有新连接到来，
   * 并设置数据转发、关闭和错误的事件处理。
   *
   * @param clientId - 处理该连接的客户端唯一标识 ID
   * @param port - 代理端口号
   * @param socket - 外部用户的 TCP socket 连接
   * @param initialData - 初始数据（如果有的话）
   */
  private handleTcpConnection(clientId: string, port: number, socket: Socket, initialData?: Buffer): void {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    const remoteAddress = socket.remoteAddress || '';

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      logger.error(`客户端 ${clientId} 未连接，拒绝 TCP 连接 ${connectionId}`);
      socket.destroy();
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, remoteAddress, 'tcp');

    logger.log(`TCP 连接: ${remoteAddress}:${socket.remotePort} -> :${port} (${connectionId})`);

    // 存储用户 TCP socket 引用
    this.userTcpSockets.set(connectionId, socket);

    // 恢复 socket 以便接收数据
    socket.resume();

    // 发送新连接消息给客户端
    const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
      connectionId,
      protocol: 'tcp',
      remoteAddress,
    });

    clientSocket.send(JSON.stringify(newConnMsg));

    // 如果有初始数据，转发给客户端
    if (initialData && initialData.length > 0) {
      this.forwardTcpDataToClient(clientId, connectionId, initialData);
    }

    // 处理来自用户的数据
    socket.on('data', (data: Buffer) => {
      this.forwardTcpDataToClient(clientId, connectionId, data);
    });

    // 处理来自用户关闭
    socket.on('close', () => {
      logger.log(`用户 TCP 连接已关闭: ${connectionId}`);
      this.notifyClientClose(clientId, connectionId, 1000);
      this.cleanupTcpConnection(connectionId);
    });

    // 处理错误
    socket.on('error', (error) => {
      logger.error(`用户 TCP 连接错误 ${connectionId}:`, error);
      this.cleanupTcpConnection(connectionId);
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
   * 将用户 TCP 数据转发到穿透客户端
   *
   * 将外部用户发送的 TCP 数据编码为 Base64 后，通过控制通道发送给穿透客户端。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 连接唯一标识 ID
   * @param data - 用户发送的原始数据
   */
  private forwardTcpDataToClient(clientId: string, connectionId: string, data: Buffer): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(JSON.stringify({
        type: 'tcp_data',
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
   * 处理来自穿透客户端的 TCP 数据
   *
   * 将穿透客户端发送的 TCP 数据转发给对应的外部用户 TCP 连接。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 穿透客户端发送的数据（Base64 编码）
   */
  handleTcpData(connectionId: string, data: Buffer): void {
    const socket = this.userTcpSockets.get(connectionId);
    logger.log(`[TCP] handleTcpData called: connectionId=${connectionId}, socket exists=${!!socket}, data length=${data.length}`);
    if (socket && !socket.destroyed) {
      logger.log(`转发 TCP 数据到用户 ${connectionId}: ${data.length} 字节`);
      socket.write(data);
    } else {
      logger.warn(`[TCP] socket not found or destroyed for connectionId=${connectionId}`);
    }
  }

  /**
   * 处理来自穿透客户端的关闭请求
   *
   * 当穿透客户端请求关闭某个连接时，关闭对应的外部用户连接（WebSocket 或 TCP）并清理资源。
   *
   * @param connectionId - 需要关闭的连接唯一标识 ID
   * @param code - 可选的 WebSocket 关闭状态码，默认为 1000（正常关闭）
   */
  handleClientClose(connectionId: string, code?: number): void {
    // 先尝试 WebSocket 连接
    const userWs = this.userConnections.get(connectionId);
    if (userWs) {
      userWs.close(code || 1000);
      this.cleanupConnection(connectionId);
      return;
    }

    // 再尝试 TCP 连接
    const tcpSocket = this.userTcpSockets.get(connectionId);
    if (tcpSocket) {
      tcpSocket.destroy();
      this.cleanupTcpConnection(connectionId);
    }
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
    this.streamingResponses.delete(connectionId);
    this.sessionManager.removeConnection(connectionId);
  }

  /**
   * 清理 TCP 连接资源
   *
   * 从 TCP 连接映射表和会话管理器中移除指定连接的记录。
   *
   * @param connectionId - 需要清理的连接唯一标识 ID
   */
  private cleanupTcpConnection(connectionId: string): void {
    this.userTcpSockets.delete(connectionId);
    this.sessionManager.removeConnection(connectionId);
  }

  /**
   * 处理来自客户端的流式响应数据
   *
   * 将客户端发送的流式数据（如 SSE 事件）转发给对应的外部 HTTP 连接。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 客户端发送的流式数据
   */
  handleClientStreamData(connectionId: string, data: Buffer): void {
    const res = this.streamingResponses.get(connectionId);
    if (res && !res.writableEnded) {
      res.write(data);
    }
  }

  /**
   * 处理来自客户端的流式响应结束通知
   *
   * 当客户端通知流式响应结束时，关闭外部 HTTP 连接并清理资源。
   *
   * @param connectionId - 连接唯一标识 ID
   */
  handleClientStreamEnd(connectionId: string): void {
    const res = this.streamingResponses.get(connectionId);
    if (res && !res.writableEnded) {
      res.end();
    }
    logger.log(`流式响应结束: ${connectionId}`);
    this.cleanupConnection(connectionId);
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
      // 关闭所有活跃的 TCP 连接
      for (const [connId, socket] of this.userTcpSockets.entries()) {
        socket.destroy();
        this.userTcpSockets.delete(connId);
      }

      return new Promise<void>((resolve) => {
        server.tcpServer.close(() => {
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
