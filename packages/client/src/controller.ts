/**
 * @module controller
 *
 * 客户端控制器模块。
 *
 * 管理客户端与穿透服务器之间的 WebSocket 控制连接，
 * 负责身份认证、心跳保活、消息收发、断线重连等核心通信逻辑。
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import {
  MessageType,
  isMessageType,
  createMessage,
  AuthMessage,
  AuthRespMessage,
  HeartbeatMessage,
  HeartbeatRespMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
  ConnectionErrorMessage,
  logger,
} from '@feng3d/chuantou-shared';
import { Config } from './config.js';

/**
 * 客户端控制器类，管理与穿透服务器的 WebSocket 控制连接。
 *
 * 继承自 {@link EventEmitter}，提供以下事件：
 * - `connected` - 成功连接到服务器时触发
 * - `disconnected` - 与服务器断开连接时触发
 * - `authenticated` - 身份认证成功时触发
 * - `maxReconnectAttemptsReached` - 达到最大重连次数时触发
 * - `newConnection` - 收到新的代理连接请求时触发
 * - `connectionClose` - 收到连接关闭通知时触发
 * - `connectionError` - 收到连接错误通知时触发
 *
 * @example
 * ```typescript
 * const controller = new Controller(config);
 * controller.on('authenticated', () => logger.log('已认证'));
 * await controller.connect();
 * ```
 */
export class Controller extends EventEmitter {
  /** 客户端配置实例 */
  private config: Config;

  /** 与服务器的 WebSocket 连接实例 */
  private ws: WebSocket | null = null;

  /** 是否已连接到服务器 */
  private connected: boolean = false;

  /** 是否已通过身份认证 */
  private authenticated: boolean = false;

  /** 重连定时器 */
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** 心跳定时器 */
  private heartbeatTimer: NodeJS.Timeout | null = null;

  /** 当前重连尝试次数 */
  private reconnectAttempts: number = 0;

  /** 待响应的请求映射表，键为消息 ID */
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  /**
   * 创建控制器实例。
   *
   * @param config - 客户端配置对象
   */
  constructor(config: Config) {
    super();
    this.config = config;
  }

  /**
   * 连接到穿透服务器。
   *
   * 建立 WebSocket 连接后会自动进行身份认证和启动心跳。
   * 连接断开时会自动安排重连。
   *
   * @returns 连接并认证成功后解析的 Promise
   * @throws {Error} 连接失败或认证失败时抛出错误
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      logger.log(`正在连接 ${this.config.serverUrl}...`);

      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on('open', async () => {
        logger.log('已连接到服务器');
        this.connected = true;
        this.reconnectAttempts = 0;
        this.emit('connected');

        // 认证
        try {
          await this.authenticate();
          this.startHeartbeat();
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        logger.log('连接已关闭');
        this.connected = false;
        this.authenticated = false;
        this.stopHeartbeat();
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        logger.error('WebSocket 错误:', error.message);
        if (!this.connected) {
          reject(error);
        }
      });
    });
  }

  /**
   * 向服务器发送身份认证请求。
   *
   * 使用配置中的 token 进行认证，认证成功后触发 `authenticated` 事件。
   *
   * @throws {Error} 认证失败时抛出错误，包含服务器返回的错误信息
   */
  private async authenticate(): Promise<void> {
    logger.log('正在认证...');

    const authMsg: AuthMessage = createMessage(MessageType.AUTH, {
      token: this.config.token,
    });

    const response = await this.sendRequest<AuthRespMessage>(authMsg);
    if (!response.payload.success) {
      throw new Error(`认证失败: ${response.payload.error}`);
    }

    this.authenticated = true;
    logger.log('认证成功');
    this.emit('authenticated');
  }

  /**
   * 启动心跳定时器。
   *
   * 每 30 秒向服务器发送一次心跳消息，仅在已连接且已认证状态下发送。
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.authenticated) {
        const heartbeatMsg: HeartbeatMessage = createMessage(MessageType.HEARTBEAT, {
          timestamp: Date.now(),
        });
        this.sendMessage(heartbeatMsg);
      }
    }, 30000); // 30秒
  }

  /**
   * 停止心跳定时器。
   *
   * 清除心跳定时器并将其设置为 null。
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 安排断线重连。
   *
   * 使用指数退避策略计算重连延迟时间。如果已达到最大重连次数，
   * 则触发 `maxReconnectAttemptsReached` 事件并停止重连。
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // 已经安排了重连
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      logger.error('已达到最大重连次数');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = this.calculateReconnectDelay();
    logger.log(`将在 ${delay}ms 后重连... (第 ${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts} 次尝试)`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error('重连失败:', errorMessage);
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * 计算重连延迟时间（指数退避算法）。
   *
   * 基于重连间隔和当前重连次数计算延迟，最大不超过 60 秒，
   * 并添加 0~1 秒的随机抖动以避免多客户端同时重连造成服务器压力。
   *
   * @returns 重连延迟时间（毫秒）
   */
  private calculateReconnectDelay(): number {
    const baseDelay = this.config.reconnectInterval;
    const maxDelay = 60000; // 最大60秒
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
    // 添加随机抖动
    return delay + Math.random() * 1000;
  }

  /**
   * 处理从服务器接收到的消息。
   *
   * 根据消息类型进行分发：
   * - 响应类消息（AUTH_RESP、REGISTER_RESP、HEARTBEAT_RESP）交由 {@link handleResponse} 处理
   * - 新连接、连接关闭、连接错误等消息通过事件触发通知上层
   *
   * @param data - 接收到的原始消息数据
   */
  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      const msgType = message.type;

      switch (msgType) {
        case MessageType.AUTH_RESP:
        case MessageType.REGISTER_RESP:
        case MessageType.HEARTBEAT_RESP:
          // 响应消息，由pendingRequests处理
          this.handleResponse(message);
          break;

        case MessageType.NEW_CONNECTION:
          this.emit('newConnection', message as NewConnectionMessage);
          break;

        case MessageType.CONNECTION_CLOSE:
          this.emit('connectionClose', message as ConnectionCloseMessage);
          break;

        case MessageType.CONNECTION_ERROR:
          this.emit('connectionError', message as ConnectionErrorMessage);
          break;

        default:
          logger.warn(`未知消息类型: ${msgType}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('处理消息时出错:', errorMessage);
    }
  }

  /**
   * 处理响应类消息。
   *
   * 根据消息 ID 查找对应的待处理请求，清除超时定时器并解析 Promise。
   *
   * @param message - 服务器返回的响应消息对象
   */
  private handleResponse(message: any): void {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      pending.resolve(message);
    }
  }

  /**
   * 发送请求消息并等待服务器响应。
   *
   * 将消息发送到服务器，并在指定超时时间内等待对应的响应消息。
   * 如果超时未收到响应，Promise 将被拒绝。
   *
   * @typeParam T - 期望的响应消息类型
   * @param message - 要发送的请求消息对象，必须包含 `id` 字段
   * @param timeout - 请求超时时间（毫秒），默认为 30000
   * @returns 服务器响应消息的 Promise
   * @throws {Error} 请求超时时抛出 "Request timeout" 错误
   */
  sendRequest<T>(message: any, timeout: number = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error('请求超时'));
      }, timeout);

      this.pendingRequests.set(message.id, { resolve, reject, timeout: timer });
      this.sendMessage(message);
    });
  }

  /**
   * 向服务器发送消息。
   *
   * 将消息对象序列化为 JSON 并通过 WebSocket 发送。
   * 仅在 WebSocket 连接处于 OPEN 状态时才能发送。
   *
   * @param message - 要发送的消息对象
   * @returns 发送成功返回 `true`，未连接时返回 `false`
   */
  sendMessage(message: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    logger.error('无法发送消息: 未连接');
    return false;
  }

  /**
   * 检查是否已连接到服务器。
   *
   * @returns 已连接返回 `true`，否则返回 `false`
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 检查是否已通过身份认证。
   *
   * @returns 已认证返回 `true`，否则返回 `false`
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * 获取当前重连尝试次数。
   *
   * @returns 当前重连次数
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * 断开与服务器的连接。
   *
   * 清除重连定时器、停止心跳、关闭 WebSocket 连接，
   * 并重置连接和认证状态。
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  /**
   * 销毁控制器实例，释放所有资源。
   *
   * 断开连接、清除所有待处理请求的超时定时器、
   * 清空待处理请求映射表并移除所有事件监听器。
   */
  destroy(): void {
    this.disconnect();
    for (const { timeout } of this.pendingRequests.values()) {
      clearTimeout(timeout);
    }
    this.pendingRequests.clear();
    this.removeAllListeners();
  }
}
