import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { Controller } from '../controller.js';
import { ProxyConfig, HttpHeaders } from '@zhuanfa/shared';
import {
  MessageType,
  createMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
} from '@zhuanfa/shared';

/**
 * WebSocket连接处理器
 */
export class WsHandler extends EventEmitter {
  private controller: Controller;
  private config: ProxyConfig;
  private localConnections: Map<string, WebSocket>;

  constructor(controller: Controller, config: ProxyConfig) {
    super();
    this.controller = controller;
    this.config = config;
    this.localConnections = new Map();

    // 监听新连接事件
    this.controller.on('newConnection', (msg: NewConnectionMessage) => {
      if (msg.payload.protocol === 'websocket') {
        this.handleNewConnection(msg);
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
   * 设置数据监听器
   */
  private setupDataListener(): void {
    // 监听控制器的原始消息
    const controller = this.controller as any;
    if (controller.ws) {
      controller.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'connection_data') {
            this.handleClientData(msg.connectionId, msg.data);
          }
        } catch (error) {
          // 忽略解析错误
        }
      });
    }
  }

  /**
   * 处理新连接
   */
  private handleNewConnection(msg: NewConnectionMessage): void {
    const { connectionId, url, wsHeaders } = msg.payload;

    console.log(`WebSocket connection: ${url} (${connectionId})`);

    // 构建本地WebSocket URL
    const localUrl = `ws://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;

    // 连接到本地WebSocket服务
    const localWs = new WebSocket(localUrl, {
      headers: this.filterHeaders(wsHeaders),
    });

    localWs.on('open', () => {
      console.log(`Local WebSocket connected: ${connectionId}`);
    });

    localWs.on('message', (data: Buffer) => {
      this.forwardToServer(connectionId, data);
    });

    localWs.on('close', (code: number, reason: Buffer) => {
      console.log(`Local WebSocket closed: ${connectionId} (${code})`);
      this.notifyServerClose(connectionId, code);
      this.cleanupConnection(connectionId);
    });

    localWs.on('error', (error) => {
      console.error(`Local WebSocket error ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId, 1011);
      this.cleanupConnection(connectionId);
    });

    this.localConnections.set(connectionId, localWs);
  }

  /**
   * 转发消息到服务器
   */
  private forwardToServer(connectionId: string, data: Buffer): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === 1) {
      controller.ws.send(JSON.stringify({
        type: 'connection_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 处理来自服务器的数据
   */
  private handleClientData(connectionId: string, data: string): void {
    const localWs = this.localConnections.get(connectionId);
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      localWs.send(Buffer.from(data, 'base64'));
    }
  }

  /**
   * 通知服务器连接关闭
   */
  private notifyServerClose(connectionId: string, code: number): void {
    const closeMsg = createMessage(MessageType.CONNECTION_CLOSE, {
      connectionId,
    });
    this.controller.sendMessage(closeMsg);
  }

  /**
   * 处理来自服务器的连接关闭
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const { connectionId } = msg.payload;
    const localWs = this.localConnections.get(connectionId);
    if (localWs) {
      localWs.close(1000, 'Server closed connection');
    }
    this.cleanupConnection(connectionId);
  }

  /**
   * 清理连接
   */
  private cleanupConnection(connectionId: string): void {
    const localWs = this.localConnections.get(connectionId);
    if (localWs) {
      localWs.removeAllListeners();
    }
    this.localConnections.delete(connectionId);
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
    for (const ws of this.localConnections.values()) {
      ws.close(1000, 'Handler destroyed');
    }
    this.localConnections.clear();
    this.removeAllListeners();
  }
}
