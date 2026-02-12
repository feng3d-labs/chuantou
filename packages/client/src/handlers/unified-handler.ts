/**
 * @module handlers/unified-handler
 *
 * 统一代理连接处理器模块。
 *
 * 负责处理通过穿透隧道传输的 HTTP、WebSocket 和 TCP 连接。
 * 同时支持三种协议的请求转发，无需区分协议类型。
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
 * 同时支持 HTTP 请求转发、WebSocket 连接桥接和 TCP 数据转发。
 *
 * 触发的事件：
 * - `error` - 处理连接时发生错误
 */
export class UnifiedHandler extends EventEmitter {
  private controller: Controller;
  private config: ProxyConfig;

  /** 正在处理的 HTTP 连接映射表 */
  private pendingConnections: Map<string, { req: any }> = new Map();

  /** 本地 WebSocket 连接映射表 */
  private localWsConnections: Map<string, WebSocket> = new Map();

  /** 本地 TCP 连接映射表 */
  private localTcpConnections: Map<string, Socket> = new Map();

  /** 流式 HTTP 响应映射表（如 SSE） */
  private streamingResponses: Map<string, any> = new Map();

  constructor(controller: Controller, config: ProxyConfig) {
    super();
    this.controller = controller;
    this.config = config;

    // 监听新连接事件
    this.controller.on('newConnection', (msg: NewConnectionMessage) => {
      // 只处理属于自己 remotePort 的连接
      if (msg.payload.remotePort !== undefined && msg.payload.remotePort !== this.config.remotePort) {
        return;
      }

      if (msg.payload.protocol === 'http') {
        this.handleHttpConnection(msg);
      } else if (msg.payload.protocol === 'websocket') {
        this.handleWebSocketConnection(msg);
      } else if (msg.payload.protocol === 'tcp') {
        this.handleTcpConnection(msg);
      }
    });

    // 监听来自服务器的数据消息
    this.controller.on('tcpData', (msg: any) => {
      this.handleClientData(msg.connectionId, msg.data);
    });

    // 监听连接关闭事件
    this.controller.on('connectionClose', (msg: ConnectionCloseMessage) => {
      this.handleConnectionClose(msg);
    });
  }

  /**
   * 处理来自服务器的新 HTTP 连接请求。
   */
  private async handleHttpConnection(msg: NewConnectionMessage): Promise<void> {
    const { connectionId, method, url, headers, body } = msg.payload;

    logger.log(`HTTP 请求: ${method} ${url} (${connectionId})`);

    const localUrl = `http://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;
    const parsedUrl = new URL(localUrl);

    const options = {
      method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || this.config.localPort,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: this.filterHeaders(headers),
      rejectUnauthorized: false,
    };

    const requestFn = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest;

    try {
      const req = requestFn(options, (res) => {
        const contentType = (res.headers['content-type'] || '').toLowerCase();
        const isSSE = contentType.includes('text/event-stream');

        if (isSSE) {
          logger.log(`SSE 流: ${url} (${connectionId})`);
          this.controller.sendMessage({
            type: 'http_response_headers',
            connectionId,
            statusCode: res.statusCode || 200,
            headers: res.headers as Record<string, string>,
          });
          this.streamingResponses.set(connectionId, res);

          res.on('data', (chunk: Buffer) => {
            this.controller.sendMessage({
              type: 'http_response_data',
              connectionId,
              data: chunk.toString('base64'),
            });
          });

          res.on('end', () => {
            logger.log(`SSE 结束: ${connectionId}`);
            this.controller.sendMessage({ type: 'http_response_end', connectionId });
            this.streamingResponses.delete(connectionId);
          });

          res.on('error', (error) => {
            logger.error(`SSE 错误 ${connectionId}:`, error.message);
            this.controller.sendMessage({ type: 'http_response_end', connectionId });
            this.streamingResponses.delete(connectionId);
          });
        } else {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          res.on('end', () => {
            const body = Buffer.concat(chunks);
            this.sendHttpResponse(connectionId, {
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

      if (body) {
        req.write(Buffer.from(body as string, 'base64'));
      }

      req.end();

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

    const localUrl = `ws://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;

    const localWs = new WebSocket(localUrl, {
      headers: this.filterHeaders(wsHeaders),
    });

    localWs.on('open', () => {
      logger.log(`本地 WebSocket 已连接: ${connectionId}`);
    });

    localWs.on('message', (data: Buffer) => {
      this.forwardDataToServer('connection_data', connectionId, data);
    });

    localWs.on('close', (code: number) => {
      logger.log(`本地 WebSocket 已关闭: ${connectionId} (${code})`);
      this.notifyServerClose(connectionId);
      this.cleanupWsConnection(connectionId);
    });

    localWs.on('error', (error) => {
      logger.error(`本地 WebSocket 错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId);
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

    const socket = new Socket();

    socket.on('connect', () => {
      logger.log(`TCP 已连接: ${connectionId}`);
    });

    socket.on('data', (data: Buffer) => {
      this.forwardDataToServer('tcp_data', connectionId, data);
    });

    socket.on('close', () => {
      logger.log(`TCP 连接关闭: ${connectionId}`);
      this.notifyServerClose(connectionId);
      this.cleanupTcpConnection(connectionId);
    });

    socket.on('error', (error: Error) => {
      logger.error(`TCP 连接错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId);
      this.cleanupTcpConnection(connectionId);
    });

    socket.connect({
      host: this.config.localHost || 'localhost',
      port: this.config.localPort,
    });

    this.localTcpConnections.set(connectionId, socket);
  }

  /**
   * 将本地数据转发到服务器（用于 WebSocket 和 TCP）。
   */
  private forwardDataToServer(type: string, connectionId: string, data: Buffer): void {
    this.controller.sendMessage({ type, connectionId, data: data.toString('base64') });
  }

  /**
   * 处理从服务器接收到的远程客户端数据。
   */
  private handleClientData(connectionId: string, data: string): void {
    const buffer = Buffer.from(data, 'base64');

    // 尝试转发到 WebSocket 连接
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      localWs.send(buffer);
      return;
    }

    // 尝试转发到 TCP 连接
    const localTcpSocket = this.localTcpConnections.get(connectionId);
    if (localTcpSocket && !localTcpSocket.destroyed) {
      localTcpSocket.write(buffer);
      return;
    }

    logger.warn(`连接 ${connectionId} 不存在或已关闭`);
  }

  /**
   * 将 HTTP 响应数据发送回服务器。
   */
  private sendHttpResponse(connectionId: string, response: HttpResponseData): void {
    this.controller.sendMessage({ type: 'http_response', connectionId, ...response });
    this.pendingConnections.delete(connectionId);
  }

  /**
   * 向服务器发送错误响应。
   */
  private sendError(connectionId: string, error: string): void {
    this.sendHttpResponse(connectionId, {
      statusCode: 500,
      headers: {},
      body: error,
    });
    this.emit('error', new Error(`连接 ${connectionId} 错误: ${error}`));
  }

  /**
   * 通知服务器某个连接已关闭。
   */
  private notifyServerClose(connectionId: string): void {
    this.controller.sendMessage(createMessage(MessageType.CONNECTION_CLOSE, { connectionId }));
  }

  /**
   * 处理来自服务器的连接关闭通知。
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const { connectionId } = msg.payload;

    const localWs = this.localWsConnections.get(connectionId);
    if (localWs) {
      localWs.close(1000, '服务器已关闭连接');
    }
    this.cleanupWsConnection(connectionId);
    this.cleanupTcpConnection(connectionId);
  }

  private cleanupWsConnection(connectionId: string): void {
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs) {
      localWs.removeAllListeners();
    }
    this.localWsConnections.delete(connectionId);
  }

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
    for (const { req } of this.pendingConnections.values()) {
      req.destroy();
    }
    this.pendingConnections.clear();

    for (const res of this.streamingResponses.values()) {
      res.destroy();
    }
    this.streamingResponses.clear();

    for (const ws of this.localWsConnections.values()) {
      ws.close(1000, '处理器已销毁');
    }
    this.localWsConnections.clear();

    for (const socket of this.localTcpConnections.values()) {
      socket.destroy();
    }
    this.localTcpConnections.clear();

    this.removeAllListeners();
  }
}
