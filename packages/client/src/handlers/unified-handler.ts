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
   */
  private setupDataListener(): void {
    const controller = this.controller as any;
    if (controller.ws) {
      controller.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connection_data') {
            this.handleClientData(msg.connectionId, msg.data);
          }
        } catch {
          // 忽略解析错误
        }
      });
    }
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
        const response: HttpResponseData = {
          statusCode: res.statusCode || 200,
          headers: res.headers as Record<string, string>,
        };

        // 收集响应体
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on('end', () => {
          response.body = Buffer.concat(chunks).toString('base64');
          this.sendResponse(connectionId, response);
        });

        res.on('error', (error) => {
          this.sendError(connectionId, error.message);
        });
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
   * 将本地数据转发到服务器。
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
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      localWs.send(Buffer.from(data, 'base64'));
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
   * 通知服务器某个 WebSocket 连接已关闭。
   */
  private notifyServerClose(connectionId: string, code: number): void {
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

    // 关闭 HTTP 连接
    const pending = this.pendingConnections.get(connectionId);
    if (pending) {
      pending.req.destroy();
      this.pendingConnections.delete(connectionId);
    }

    // 关闭 WebSocket 连接
    const localWs = this.localWsConnections.get(connectionId);
    if (localWs) {
      localWs.close(1000, '服务器已关闭连接');
    }
    this.cleanupWsConnection(connectionId);
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

    // 销毁 WebSocket 连接
    for (const ws of this.localWsConnections.values()) {
      ws.close(1000, '处理器已销毁');
    }
    this.localWsConnections.clear();

    this.removeAllListeners();
  }
}
