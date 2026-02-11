/**
 * @module handlers/tcp-handler
 *
 * TCP 连接处理器模块。
 *
 * 负责处理通过穿透隧道传输的原始 TCP 连接（如 SSH、MySQL 等）。
 * 使用原始 TCP socket 进行双向数据转发，不解析应用层协议。
 */

import { EventEmitter } from 'events';
import { Socket, connect } from 'net';
import { Controller } from '../controller.js';
import { ProxyConfig, logger, createMessage, MessageType } from '@feng3d/chuantou-shared';

/**
 * TCP 连接处理器类。
 *
 * 继承自 {@link EventEmitter}，负责在远程客户端和本地 TCP 服务之间建立双向数据转发通道。
 *
 * 工作流程：
 * 1. 监听控制器的 `newConnection` 事件（协议类型为 'tcp'）
 * 2. 建立到本地 TCP 服务的 socket 连接
 * 3. 将本地服务发送的数据转发给服务器
 * 4. 将服务器转发的远程客户端数据转发到本地服务
 * 5. 处理连接关闭和错误情况
 *
 * 触发的事件：
 * - `error` - 处理连接时发生错误
 */
export class TcpHandler extends EventEmitter {
  /** 控制器实例，用于与服务器通信 */
  private controller: Controller;

  /** 代理配置，包含本地服务地址和端口信息 */
  private config: ProxyConfig;

  /** 本地 TCP 连接映射表 */
  private localConnections: Map<string, Socket> = new Map();

  /**
   * 创建 TCP 处理器实例。
   *
   * @param controller - 控制器实例，用于与服务器通信
   * @param config - 代理配置对象，包含本地服务地址和端口
   */
  constructor(controller: Controller, config: ProxyConfig) {
    super();
    this.controller = controller;
    this.config = config;

    // 监听新连接事件
    this.controller.on('newConnection', (msg) => {
      if (msg.payload.protocol === 'tcp') {
        this.handleTcpConnection(msg);
      }
    });

    // 监听来自服务器的 TCP 数据消息（通过 controller 事件）
    // 注意：服务器发送的是简化格式 { type, connectionId, data }，不是标准的 TcpDataMessage 格式
    this.controller.on('tcpData', (msg: any) => {
      // 兼容两种格式：标准格式有 payload，简化格式直接有 connectionId 和 data
      const connectionId = msg.payload?.connectionId || msg.connectionId;
      const data = msg.payload?.data || msg.data;
      this.handleTcpData(connectionId, data);
      logger.log(`收到 TCP 数据: ${connectionId}, 数据长度: ${data?.length || 0}`);
    });

    // 监听连接关闭事件
    this.controller.on('connectionClose', (msg) => {
      this.handleConnectionClose(msg);
    });
  }

  /**
   * 设置从服务器接收 TCP 数据的监听器。
   */
  private setupTcpDataListener(): void {
    const controller = this.controller as any;
    if (controller.ws) {
      controller.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'tcp_data_resp') {
            this.handleTcpData(msg.connectionId, msg.data);
          }
        } catch {
          // 忽略解析错误
        }
      });
    }
  }

  /**
   * 处理来自服务器的新 TCP 连接请求。
   */
  private async handleTcpConnection(msg: any): Promise<void> {
    const { connectionId, remoteAddress } = msg.payload;

    logger.log(`TCP 连接: ${remoteAddress} -> ${this.config.localHost || 'localhost'}:${this.config.localPort} (${connectionId})`);

    // 连接到本地 TCP 服务
    const socket = new Socket();

    socket.on('connect', () => {
      logger.log(`TCP 已连接: ${connectionId}`);
    });

    socket.on('data', (data: Buffer) => {
      this.forwardToServer(connectionId, data);
    });

    socket.on('close', () => {
      logger.log(`TCP 连接关闭: ${connectionId}`);
      this.notifyServerClose(connectionId);
      this.cleanupConnection(connectionId);
    });

    socket.on('error', (error: Error) => {
      logger.error(`TCP 连接错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId);
      this.cleanupConnection(connectionId);
    });

    // 连接到本地服务
    socket.connect({
      host: this.config.localHost || 'localhost',
      port: this.config.localPort,
    });

    // 保存连接引用
    this.localConnections.set(connectionId, socket);

    // 如果有初始数据，发送到本地服务
    if (msg.payload.data) {
      try {
        socket.write(Buffer.from(msg.payload.data, 'base64'));
      } catch (error) {
        logger.error(`发送初始数据到本地服务失败: ${error}`);
      }
    }
  }

  /**
   * 将本地 TCP 数据转发到服务器。
   */
  private forwardToServer(connectionId: string, data: Buffer): void {
    const controller = this.controller as any;
    if (controller.ws && controller.ws.readyState === 1) {
      controller.ws.send(JSON.stringify({
        type: 'tcp_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 处理从服务器接收到的远程 TCP 数据。
   */
  private handleTcpData(connectionId: string, base64Data: string): void {
    const socket = this.localConnections.get(connectionId);
    if (socket && !socket.destroyed) {
      try {
        socket.write(Buffer.from(base64Data, 'base64'));
      } catch (error) {
        logger.error(`转发 TCP 数据到本地服务失败 ${connectionId}:`, error);
      }
    }
  }

  /**
   * 通知服务器 TCP 连接已关闭。
   */
  private notifyServerClose(connectionId: string): void {
    const closeMsg = createMessage(MessageType.CONNECTION_CLOSE, {
      connectionId,
    });
    this.controller.sendMessage(closeMsg);
  }

  /**
   * 处理来自服务器的连接关闭通知。
   */
  private handleConnectionClose(msg: any): void {
    const { connectionId } = msg.payload;
    const socket = this.localConnections.get(connectionId);
    if (socket) {
      socket.destroy();
      this.localConnections.delete(connectionId);
    }
  }

  /**
   * 清理 TCP 连接资源。
   */
  private cleanupConnection(connectionId: string): void {
    this.localConnections.delete(connectionId);
  }

  /**
   * 过滤请求头（TCP 协议不需要，但保持接口一致性）。
   */
  private filterHeaders(headers: any): Record<string, string> {
    return headers || {};
  }

  /**
   * 销毁处理器，释放所有资源。
   */
  destroy(): void {
    // 关闭所有 TCP 连接
    for (const socket of this.localConnections.values()) {
      try {
        socket.destroy();
      } catch {
        // 忽略错误
      }
    }
    this.localConnections.clear();

    this.removeAllListeners();
  }
}
