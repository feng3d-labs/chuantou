import { EventEmitter } from 'events';
import { Controller } from '../controller.js';
import { ProxyConfig, HttpHeaders } from '@zhuanfa/shared';
import {
  MessageType,
  createMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
  HttpResponseData,
} from '@zhuanfa/shared';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

/**
 * HTTP请求处理器
 */
export class HttpHandler extends EventEmitter {
  private controller: Controller;
  private config: ProxyConfig;
  private pendingConnections: Map<string, {
    resolve: (value: HttpResponseData) => void;
    reject: (error: Error) => void;
    req: any;
  }> = new Map();

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
   * 处理新连接
   */
  private async handleNewConnection(msg: NewConnectionMessage): Promise<void> {
    const { connectionId, method, url, headers, body } = msg.payload;

    console.log(`HTTP request: ${method} ${url} (${connectionId})`);

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
   * 发送响应
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
   * 发送错误
   */
  private sendError(connectionId: string, error: string): void {
    this.sendResponse(connectionId, {
      statusCode: 500,
      headers: {},
      body: error,
    });
    this.emit('error', new Error(`Connection ${connectionId} error: ${error}`));
  }

  /**
   * 处理连接关闭
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const pending = this.pendingConnections.get(msg.payload.connectionId);
    if (pending) {
      pending.req.destroy();
      this.pendingConnections.delete(msg.payload.connectionId);
    }
  }

  /**
   * 过滤请求头
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
   * 销毁
   */
  destroy(): void {
    for (const { req } of this.pendingConnections.values()) {
      req.destroy();
    }
    this.pendingConnections.clear();
    this.removeAllListeners();
  }
}
