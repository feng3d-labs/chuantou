/**
 * @module handlers/unified-handler
 *
 * 统一代理连接处理器模块。
 *
 * 负责处理通过穿透隧道传输的 HTTP 和 WebSocket 连接。
 * 同时支持 HTTP 请求转发和 WebSocket 连接桥接，无需区分协议类型。
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { Socket } from 'net';
import { Controller } from '../controller.js';
import { ProxyConfig, HttpHeaders, logger } from '@feng3d/chuantou-shared';
import {
  MessageType,
  createMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
  HttpResponseData,
} from '@feng3d/chuantou-shared';

/**
 * 统一代理连接处理器类。
 *
 * 继承自 {@link EventEmitter}，负责在远程客户端和本地服务之间建立双向数据转发通道。
 * 同时支持 HTTP 请求转发和 WebSocket 连接桥接。
 *
 * 工作流程：
 * 1. 监听控制器的 `newConnection` 事件，接收新的连接请求
 * 2. 根据协议类型（http/websocket）建立相应的本地连接
 * 3. 将本地服务发送的数据转发给服务器
 * 4. 将服务器转发的远程客户端数据转发到本地服务
 * 5. 处理连接关闭和错误情况
 *
 * 触发的事件：
 * - `error` - 处理连接时发生错误
 */
export class UnifiedHandler extends EventEmitter {
  /** 控制器实例，用于与服务器通信 */
  private controller: Controller;

  /** 代理配置，包含本地服务地址和端口信息 */
  private config: ProxyConfig;

  /** 正在处理的 HTTP 连接映射表 */
  private pendingConnections: Map<string, {
    /** Node.js HTTP 请求对象 */
    req: any;
  }> = new Map();

  /** 本地 WebSocket 连接映射表 */
  private localWsConnections: Map<string, WebSocket> = new Map();

  /** 本地 TCP 连接映射表 */
  private localTcpConnections: Map<string, any> = new Map();

  /** 流式 HTTP 响应映射表（如 SSE） */
  private streamingResponses: Map<string, any> = new Map();

  /**
   * 创建统一处理器实例。
   *
   * 自动监听控制器的 `newConnection` 和 `connectionClose` 事件，
   * 并设置数据转发监听器。
   *
   * @param controller - 控制器实例，用于与服务器通信
   * @param config - 代理配置对象，包含本地服务地址和端口
   */
  constructor(controller: Controller, config: ProxyConfig) {
    super();
    this.controller = controller;
    this.config = config;

    // 监听新连接事件
    this.controller.on('newConnection', (msg: NewConnectionMessage) => {
      if (msg.payload.protocol === 'http') {
        this.handleHttpConnection(msg);
      } else if (msg.payload.protocol === 'websocket') {
        this.handleWebSocketConnection(msg);
      } else if (msg.payload.protocol === 'tcp') {
        // TCP 协议（如 SSH、MySQL）
        this.handleTcpConnection(msg);
      }
    });

    // 监听来自服务器的数据消息
    this.setupDataListener();

    // 监听连接关闭事件
    this.controller.on('connectionClose', (msg: ConnectionCloseMessage) => {
      this.handleConnectionClose(msg);
    });
  }

  /**
   * 设置从服务器接收数据的监听器。
   * 监听控制器的 tcpData 事件来接收 TCP 数据。
   */
  private setupDataListener(): void {
    // 监听从服务器转发的客户端数据（通过 tcp_data 消息）
    this.controller.on('tcpData', (msg: any) => {
      // tcp_data 消息格式: { type: 'tcp_data', connectionId, data }
      this.handleClientData(msg.connectionId, msg.data);
    });
  }

  /**
   * 处理来自服务器的新 HTTP 连接请求。
   */
  private async handleHttpConnection(msg: NewConnectionMessage): Promise<void> {
    const { connectionId, method, url, headers, body } = msg.payload;

    logger.log(`HTTP 请求: ${method} ${url} (${connectionId})`);

    // 构建本地 URL
    const localUrl = `http://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;
    const parsedUrl = new URL(localUrl);

    // 准备请求选项
    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || this.config.localPort,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: this.filterHeaders(headers),
      rejectUnauthorized: false,
    };

    // 创建请求
    const requestFn = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;

    try {
      const req = requestFn(options, (res) => {
        const contentType = (res.headers['content-type'] || '').toLowerCase();
        const isSSE = contentType.includes('text/event-stream');

        if (isSSE) {
          // SSE 流式转发 - 先发送响应头
          logger.log(`SSE 流: ${url} (${connectionId})`);
          this.sendResponseHeaders(connectionId, {
            statusCode: res.statusCode || 200,
            headers: res.headers as Record<string, string>,
          });
          this.streamingResponses.set(connectionId, res);

          res.on('data', (chunk: Buffer) => {
            this.forwardStreamData(connectionId, chunk);
          });

          res.on('end', () => {
            logger.log(`SSE 结束: ${connectionId}`);
            this.notifyStreamEnd(connectionId);
            this.streamingResponses.delete(connectionId);
          });

          res.on('error', (error) => {
            logger.error(`SSE 错误 ${connectionId}:`, error.message);
            this.notifyStreamEnd(connectionId);
            this.streamingResponses.delete(connectionId);
          });
        } else {
          // 普通 HTTP 请求，收集完整响应体后一次性发送
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          res.on('end', () => {
            const body = Buffer.concat(chunks);
            this.sendResponse(connectionId, {
              statusCode: res.statusCode || 200,
              headers: res.headers as Record<string, string>,
              body: body.toString('base64'),
            });
          });

          res.on('error', (error) => {
            this.sendError(connectionId, error.message);
          });
        }
      });

      req.on('error', (error) => {
        this.sendError(connectionId, error.message);
      });

      // 发送请求体
      if (body) {
        req.write(Buffer.from(body as string, 'base64'));
      }

      req.end();

      // 存储请求引用，用于取消
      this.pendingConnections.set(connectionId, { req });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendError(connectionId, errorMessage);
    }
  }

  /**
   * 处理来自服务器的新 WebSocket 连接请求。
   */
  private handleWebSocketConnection(msg: NewConnectionMessage): void {
    const { connectionId, url, wsHeaders } = msg.payload;

    logger.log(`WebSocket 连接: ${url} (${connectionId})`);

    // 构建本地 WebSocket URL
    const localUrl = `ws://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;

    // 连接到本地 WebSocket 服务
    const localWs = new WebSocket(localUrl, {
      headers: this.filterHeaders(wsHeaders),
    });

    localWs.on('open', () => {
      logger.log(`本地 WebSocket 已连接: ${connectionId}`);
    });

    localWs.on('message', (data: Buffer) => {
      this.forwardToServer(connectionId, data);
    });

    localWs.on('close', (code: number, reason: Buffer) => {
      logger.log(`本地 WebSocket 已关闭: ${connectionId} (${code})`);
      this.notifyServerClose(connectionId, code);
      this.cleanupWsConnection(connectionId);
    });

    localWs.on('error', (error) => {
      logger.error(`本地 WebSocket 错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId, 1011);
      this.cleanupWsConnection(connectionId);
    });

    this.localWsConnections.set(connectionId, localWs);
  }

  /**
   * 处理来自服务器的新 TCP 连接请求。
   */
  private handleTcpConnection(msg: NewConnectionMessage): void {
    const { connectionId, remoteAddress } = msg.payload;

    logger.log(`TCP 连接: ${remoteAddress} -> ${this.config.localHost || 'localhost'}:${this.config.localPort} (${connectionId})`);

    // 连接到本地 TCP 服务
    const socket = new Socket();

    socket.on('connect', () => {
      logger.log(`TCP 已连接: ${connectionId}`);
    });

    socket.on('data', (data: Buffer) => {
      logger.log(`收到本地 TCP 数据 ${connectionId}: ${data.length} 字节`);
      this.forwardTcpDataToServer(connectionId, data);
    });

    socket.on('close', () => {
      logger.log(`TCP 连接关闭: ${connectionId}`);
      this.notifyServerClose(connectionId, 1000);
      this.cleanupTcpConnection(connectionId);
    });

    socket.on('error', (error: Error) => {
      logger.error(`TCP 连接错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId, 1011);
      this.cleanupTcpConnection(connectionId);
    });

    // 连接到本地服务
    socket.connect({
      host: this.config.localHost || 'localhost',
      port: this.config.localPort,
    });

    this.localTcpConnections.set(connectionId, socket);
  }

  /**
   * 将本地 TCP 数据转发到服务器。
   */
  private forwardTcpDataToServer(connectionId: string, data: Buffer): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === WebSocket.OPEN) {
      controller.ws.send(JSON.stringify({
        type: 'tcp_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 将本地数据转发到服务器（用于 WebSocket）。
   */
  private forwardToServer(connectionId: string, data: Buffer): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === WebSocket.OPEN) {
      controller.ws.send(JSON.stringify({
        type: 'connection_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 处理从服务器接收到的远程客户端数据。
   */
  private handleClientData(connectionId: string, data: string): void {
    logger.log(`收到服务器数据 ${connectionId}: ${data?.length || 0} 字节`);

    // 尝试从 WebSocket 连接获取
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      localWs.send(Buffer.from(data, 'base64'));
    }

    // 尝试从 TCP 连接获取
    const localTcpSocket = this.localTcpConnections.get(connectionId);
    if (localTcpSocket && !localTcpSocket.destroyed) {
      localTcpSocket.write(Buffer.from(data, 'base64'));
      logger.log(`转发 TCP 数据到本地 ${connectionId}: ${data?.length || 0} 字节`);
    } else {
      logger.warn(`TCP 连接 ${connectionId} 不存在或已关闭`);
    }
  }

  /**
   * 将 HTTP 响应数据发送回服务器。
   */
  private sendResponse(connectionId: string, response: HttpResponseData): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === WebSocket.OPEN) {
      controller.ws.send(JSON.stringify({
        type: 'http_response',
        connectionId,
        ...response,
      }));
    }
    this.pendingConnections.delete(connectionId);
  }

  /**
   * 发送流式响应头（用于 SSE）。
   */
  private sendResponseHeaders(connectionId: string, headers: { statusCode: number; headers: Record<string, string> }): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === WebSocket.OPEN) {
      controller.ws.send(JSON.stringify({
        type: 'http_response_headers',
        connectionId,
        ...headers,
      }));
    }
  }

  /**
   * 发送流式响应数据块（用于 SSE）。
   */
  private forwardStreamData(connectionId: string, data: Buffer): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === WebSocket.OPEN) {
      controller.ws.send(JSON.stringify({
        type: 'http_response_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 通知服务器流式响应结束（用于 SSE）。
   */
  private notifyStreamEnd(connectionId: string): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === WebSocket.OPEN) {
      controller.ws.send(JSON.stringify({
        type: 'http_response_end',
        connectionId,
      }));
    }
  }


  /**
   * 向服务器发送错误响应。
   */
  private sendError(connectionId: string, error: string): void {
    this.sendResponse(connectionId, {
      statusCode: 500,
      headers: {},
      body: error,
    });
    this.emit('error', new Error(`连接 ${connectionId} 错误: ${error}`));
  }

  /**
   * 通知服务器某个连接已关闭。
   */
  private notifyServerClose(connectionId: string, code?: number): void {
    const closeMsg = createMessage(MessageType.CONNECTION_CLOSE, {
      connectionId,
    });
    this.controller.sendMessage(closeMsg);
  }

  /**
   * 处理来自服务器的连接关闭通知。
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const { connectionId } = msg.payload;

    // 尝试清理 WebSocket 连接
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs) {
      localWs.close(1000, '服务器已关闭连接');
    }
    this.cleanupWsConnection(connectionId);

    // 尝试清理 TCP 连接
    this.cleanupTcpConnection(connectionId);
  }

  /**
   * 清理 WebSocket 连接资源。
   */
  private cleanupWsConnection(connectionId: string): void {
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs) {
      localWs.removeAllListeners();
    }
    this.localWsConnections.delete(connectionId);
  }

  /**
   * 过滤请求头，移除逐跳头部字段。
   */
  /**
   * 清理 TCP 连接资源。
     */
    private cleanupTcpConnection(connectionId: string): void {
      const socket = this.localTcpConnections.get(connectionId);
      if (socket) {
        socket.destroy();
      }
      this.localTcpConnections.delete(connectionId);
    }

    /**
     * 过滤请求头，移除逐跳头部字段。
     */
    private filterHeaders(headers: HttpHeaders | undefined): Record<string, string> {
    if (!headers) {
      return {};
    }

    const filtered: Record<string, string> = {};
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
    ];

    for (const [key, value] of Object.entries(headers)) {
      if (!hopByHopHeaders.includes(key.toLowerCase()) && value !== undefined) {
        filtered[key] = Array.isArray(value) ? value.join(', ') : value;
      }
    }

    return filtered;
  }

  /**
   * 销毁处理器，释放所有资源。
   */
  destroy(): void {
    // 销毁 HTTP 连接
    for (const { req } of this.pendingConnections.values()) {
      req.destroy();
    }
    this.pendingConnections.clear();

    // 销毁流式响应
    for (const res of this.streamingResponses.values()) {
      res.destroy();
    }
    this.streamingResponses.clear();

    // 销毁 WebSocket 连接
    for (const ws of this.localWsConnections.values()) {
      ws.close(1000, '处理器已销毁');
    }
    this.localWsConnections.clear();

    // 销毁 TCP 连接
    for (const socket of this.localTcpConnections.values()) {
      socket.destroy();
    }
    this.localTcpConnections.clear();

    this.removeAllListeners();
  }
}
