/**
 * @module handlers/http-handler
 *
 * HTTP 代理请求处理器模块。
 *
 * 负责处理通过穿透隧道传输的 HTTP 请求：接收来自服务器的新连接通知，
 * 将请求转发到本地 HTTP 服务，收集响应后回传给服务器。
 * 支持 HTTP 和 HTTPS 协议的本地服务转发，并自动过滤逐跳（hop-by-hop）请求头。
 */

import { EventEmitter } from 'events';
import { Controller } from '../controller.js';
import { ProxyConfig, HttpHeaders } from '@feng3d/chuantou-shared';
import {
  MessageType,
  createMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
  HttpResponseData,
} from '@feng3d/chuantou-shared';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

/**
 * HTTP 代理请求处理器类。
 *
 * 继承自 {@link EventEmitter}，负责将服务器转发的 HTTP 请求代理到本地 HTTP 服务。
 *
 * 工作流程：
 * 1. 监听控制器的 `newConnection` 事件，接收新的 HTTP 请求
 * 2. 将请求转发到配置的本地地址和端口
 * 3. 收集本地服务的响应数据
 * 4. 将响应通过控制器回传给服务器
 *
 * 触发的事件：
 * - `error` - 处理请求时发生错误
 *
 * @example
 * ```typescript
 * const handler = new HttpHandler(controller, proxyConfig);
 * handler.on('error', (err) => console.error(err));
 * ```
 */
export class HttpHandler extends EventEmitter {
  /** 控制器实例，用于与服务器通信 */
  private controller: Controller;

  /** 代理配置，包含本地服务地址和端口信息 */
  private config: ProxyConfig;

  /** 正在处理的连接映射表，键为连接 ID */
  private pendingConnections: Map<string, {
    /** 响应解析回调 */
    resolve: (value: HttpResponseData) => void;
    /** 响应拒绝回调 */
    reject: (error: Error) => void;
    /** Node.js HTTP 请求对象 */
    req: any;
  }> = new Map();

  /**
   * 创建 HTTP 处理器实例。
   *
   * 自动监听控制器的 `newConnection` 和 `connectionClose` 事件。
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
        this.handleNewConnection(msg);
      }
    });

    // 监听连接关闭事件
    this.controller.on('connectionClose', (msg: ConnectionCloseMessage) => {
      this.handleConnectionClose(msg);
    });
  }

  /**
   * 处理来自服务器的新 HTTP 连接请求。
   *
   * 根据消息中的请求信息（方法、URL、请求头、请求体），
   * 构建并发送 HTTP 请求到本地服务，然后将响应回传给服务器。
   *
   * @param msg - 新连接消息，包含 HTTP 请求的详细信息
   */
  private async handleNewConnection(msg: NewConnectionMessage): Promise<void> {
    const { connectionId, method, url, headers, body } = msg.payload;

    console.log(`HTTP 请求: ${method} ${url} (${connectionId})`);

    // 构建本地URL
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
      this.pendingConnections.set(connectionId, { req, resolve: () => {}, reject: () => {} });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendError(connectionId, errorMessage);
    }
  }

  /**
   * 将 HTTP 响应数据发送回服务器。
   *
   * 通过控制器的 WebSocket 连接将响应数据（状态码、响应头、响应体）
   * 发送给服务器，然后从待处理连接映射表中移除该连接。
   *
   * @param connectionId - 连接唯一标识符
   * @param response - HTTP 响应数据，包含状态码、响应头和响应体
   */
  private sendResponse(connectionId: string, response: HttpResponseData): void {
    const controller = (this.controller as any);
    if (controller.ws && controller.ws.readyState === 1) {
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
   *
   * 构造一个状态码为 500 的错误响应发送给服务器，
   * 并触发 `error` 事件通知上层。
   *
   * @param connectionId - 连接唯一标识符
   * @param error - 错误描述信息
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
   * 处理来自服务器的连接关闭通知。
   *
   * 销毁对应的本地 HTTP 请求并从待处理连接映射表中移除。
   *
   * @param msg - 连接关闭消息，包含要关闭的连接 ID
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const pending = this.pendingConnections.get(msg.payload.connectionId);
    if (pending) {
      pending.req.destroy();
      this.pendingConnections.delete(msg.payload.connectionId);
    }
  }

  /**
   * 过滤 HTTP 请求头，移除逐跳（hop-by-hop）头部字段。
   *
   * 逐跳头部字段仅在单次传输连接中有效，不应被代理转发。
   * 被过滤的头部包括：connection、keep-alive、proxy-authenticate、
   * proxy-authorization、te、trailers、transfer-encoding、upgrade。
   *
   * @param headers - 原始 HTTP 请求头对象，可能为 `undefined`
   * @returns 过滤后的请求头对象，值均为字符串类型
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
   * 销毁 HTTP 处理器，释放所有资源。
   *
   * 销毁所有正在处理的 HTTP 请求、清空待处理连接映射表，
   * 并移除所有事件监听器。
   */
  destroy(): void {
    for (const { req } of this.pendingConnections.values()) {
      req.destroy();
    }
    this.pendingConnections.clear();
    this.removeAllListeners();
  }
}
