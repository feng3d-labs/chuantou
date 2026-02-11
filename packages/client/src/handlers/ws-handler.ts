/**
 * @module handlers/ws-handler
 *
 * WebSocket 代理连接处理器模块。
 *
 * 负责处理通过穿透隧道传输的 WebSocket 连接：接收来自服务器的新连接通知，
 * 建立到本地 WebSocket 服务的连接，并在远程客户端和本地服务之间双向转发数据。
 * 数据使用 Base64 编码在控制连接上传输。
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { Controller } from '../controller.js';
import { ProxyConfig, HttpHeaders } from '@feng3d/chuantou-shared';
import {
  MessageType,
  createMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
} from '@feng3d/chuantou-shared';

/**
 * WebSocket 代理连接处理器类。
 *
 * 继承自 {@link EventEmitter}，负责在远程客户端和本地 WebSocket 服务之间建立双向数据转发通道。
 *
 * 工作流程：
 * 1. 监听控制器的 `newConnection` 事件，接收新的 WebSocket 连接请求
 * 2. 建立到本地 WebSocket 服务的连接
 * 3. 将本地服务发送的数据通过 Base64 编码转发给服务器
 * 4. 将服务器转发的远程客户端数据解码后发送到本地服务
 * 5. 处理连接关闭和错误情况
 *
 * 触发的事件：
 * - `error` - 处理连接时发生错误
 *
 * @example
 * ```typescript
 * const handler = new WsHandler(controller, proxyConfig);
 * handler.on('error', (err) => console.error(err));
 * ```
 */
export class WsHandler extends EventEmitter {
  /** 控制器实例，用于与服务器通信 */
  private controller: Controller;

  /** 代理配置，包含本地 WebSocket 服务地址和端口信息 */
  private config: ProxyConfig;

  /** 本地 WebSocket 连接映射表，键为连接 ID，值为对应的 WebSocket 实例 */
  private localConnections: Map<string, WebSocket>;

  /**
   * 创建 WebSocket 处理器实例。
   *
   * 自动监听控制器的 `newConnection` 和 `connectionClose` 事件，
   * 并设置数据转发监听器。
   *
   * @param controller - 控制器实例，用于与服务器通信
   * @param config - 代理配置对象，包含本地 WebSocket 服务地址和端口
   */
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
   * 设置从服务器接收数据的监听器。
   *
   * 监听控制器底层 WebSocket 的原始消息，筛选出 `connection_data` 类型的消息
   * 并转发到对应的本地 WebSocket 连接。
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
   * 处理来自服务器的新 WebSocket 连接请求。
   *
   * 根据消息中的连接信息，建立到本地 WebSocket 服务的连接，
   * 并设置双向数据转发、关闭和错误处理的事件监听。
   *
   * @param msg - 新连接消息，包含连接 ID、URL 和 WebSocket 请求头
   */
  private handleNewConnection(msg: NewConnectionMessage): void {
    const { connectionId, url, wsHeaders } = msg.payload;

    console.log(`WebSocket 连接: ${url} (${connectionId})`);

    // 构建本地WebSocket URL
    const localUrl = `ws://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;

    // 连接到本地WebSocket服务
    const localWs = new WebSocket(localUrl, {
      headers: this.filterHeaders(wsHeaders),
    });

    localWs.on('open', () => {
      console.log(`本地 WebSocket 已连接: ${connectionId}`);
    });

    localWs.on('message', (data: Buffer) => {
      this.forwardToServer(connectionId, data);
    });

    localWs.on('close', (code: number, reason: Buffer) => {
      console.log(`本地 WebSocket 已关闭: ${connectionId} (${code})`);
      this.notifyServerClose(connectionId, code);
      this.cleanupConnection(connectionId);
    });

    localWs.on('error', (error) => {
      console.error(`本地 WebSocket 错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId, 1011);
      this.cleanupConnection(connectionId);
    });

    this.localConnections.set(connectionId, localWs);
  }

  /**
   * 将本地 WebSocket 服务的数据转发到服务器。
   *
   * 数据经过 Base64 编码后通过控制器的 WebSocket 连接发送。
   *
   * @param connectionId - 连接唯一标识符
   * @param data - 本地 WebSocket 服务发送的原始数据
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
   * 处理从服务器接收到的远程客户端数据。
   *
   * 将 Base64 编码的数据解码后发送到对应的本地 WebSocket 连接。
   *
   * @param connectionId - 连接唯一标识符
   * @param data - Base64 编码的数据字符串
   */
  private handleClientData(connectionId: string, data: string): void {
    const localWs = this.localConnections.get(connectionId);
    if (localWs && localWs.readyState === WebSocket.OPEN) {
      localWs.send(Buffer.from(data, 'base64'));
    }
  }

  /**
   * 通知服务器某个 WebSocket 连接已关闭。
   *
   * 向服务器发送连接关闭消息，以便服务器清理对应的远程连接。
   *
   * @param connectionId - 已关闭的连接唯一标识符
   * @param code - WebSocket 关闭状态码
   */
  private notifyServerClose(connectionId: string, code: number): void {
    const closeMsg = createMessage(MessageType.CONNECTION_CLOSE, {
      connectionId,
    });
    this.controller.sendMessage(closeMsg);
  }

  /**
   * 处理来自服务器的连接关闭通知。
   *
   * 关闭对应的本地 WebSocket 连接并清理资源。
   *
   * @param msg - 连接关闭消息，包含要关闭的连接 ID
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const { connectionId } = msg.payload;
    const localWs = this.localConnections.get(connectionId);
    if (localWs) {
      localWs.close(1000, '服务器已关闭连接');
    }
    this.cleanupConnection(connectionId);
  }

  /**
   * 清理指定连接的资源。
   *
   * 移除本地 WebSocket 实例的所有事件监听器，并从连接映射表中删除。
   *
   * @param connectionId - 要清理的连接唯一标识符
   */
  private cleanupConnection(connectionId: string): void {
    const localWs = this.localConnections.get(connectionId);
    if (localWs) {
      localWs.removeAllListeners();
    }
    this.localConnections.delete(connectionId);
  }

  /**
   * 过滤 WebSocket 升级请求头，移除逐跳（hop-by-hop）头部字段。
   *
   * 逐跳头部字段仅在单次传输连接中有效，不应被代理转发。
   * 被过滤的头部包括：connection、keep-alive、proxy-authenticate、
   * proxy-authorization、te、trailers、transfer-encoding、upgrade。
   *
   * @param headers - 原始请求头对象，可能为 `undefined`
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
   * 销毁 WebSocket 处理器，释放所有资源。
   *
   * 关闭所有本地 WebSocket 连接（使用状态码 1000 正常关闭）、
   * 清空连接映射表并移除所有事件监听器。
   */
  destroy(): void {
    for (const ws of this.localConnections.values()) {
      ws.close(1000, '处理器已销毁');
    }
    this.localConnections.clear();
    this.removeAllListeners();
  }
}
