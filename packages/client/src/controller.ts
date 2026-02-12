/**
 * @module controller
 *
 * 客户端控制器模块。
 *
 * 管理客户端与穿透服务器之间的 WebSocket 控制连接和二进制数据通道，
 * 负责身份认证、心跳保活、数据通道建立、消息收发、断线重连等核心通信逻辑。
 */

import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import {
  MessageType,
  createMessage,
  AuthMessage,
  AuthRespMessage,
  HeartbeatMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
  ConnectionErrorMessage,
  logger,
} from '@feng3d/chuantou-shared';
import { Config } from './config.js';
import { DataChannel } from './data-channel.js';

/**
 * 客户端控制器类。
 *
 * 事件：
 * - `connected` — 成功连接到服务器
 * - `disconnected` — 与服务器断开连接
 * - `authenticated` — 身份认证成功
 * - `maxReconnectAttemptsReached` — 达到最大重连次数
 * - `newConnection` — 收到新的代理连接请求
 * - `connectionClose` — 收到连接关闭通知
 * - `connectionError` — 收到连接错误通知
 */
export class Controller extends EventEmitter {
  private config: Config;
  private ws: WebSocket | null = null;
  private connected: boolean = false;
  private authenticated: boolean = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private pendingRequests: Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }> = new Map();

  /** 服务端分配的客户端 ID（认证成功后获得） */
  private clientId: string = '';

  /** 二进制数据通道 */
  private dataChannel: DataChannel;

  constructor(config: Config) {
    super();
    this.config = config;
    this.dataChannel = new DataChannel();
  }

  /**
   * 获取数据通道实例
   */
  getDataChannel(): DataChannel {
    return this.dataChannel;
  }

  /**
   * 获取客户端 ID
   */
  getClientId(): string {
    return this.clientId;
  }

  /**
   * 连接到穿透服务器。
   *
   * 建立 WebSocket 连接 → 认证 → 建立数据通道 → 启动心跳。
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

        try {
          await this.authenticate();
          await this.establishDataChannels();
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
        this.dataChannel.destroy();
        this.dataChannel = new DataChannel();
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
   * 认证并获取 clientId
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

    this.clientId = response.payload.clientId || '';
    this.authenticated = true;
    logger.log(`认证成功 (clientId: ${this.clientId})`);
    this.emit('authenticated');
  }

  /**
   * 建立数据通道（TCP + UDP）
   */
  private async establishDataChannels(): Promise<void> {
    if (!this.clientId) {
      throw new Error('无法建立数据通道: clientId 未分配');
    }

    // 从 WebSocket URL 解析服务端地址和端口
    const url = new URL(this.config.serverUrl);
    const host = url.hostname;
    const port = parseInt(url.port) || (url.protocol === 'wss:' ? 443 : 80);

    // 并行建立 TCP 和 UDP 数据通道
    await Promise.all([
      this.dataChannel.connectTcp(host, port, this.clientId).catch((error) => {
        logger.error('TCP 数据通道建立失败:', error.message);
        throw error;
      }),
      this.dataChannel.connectUdp(host, port, this.clientId).catch((error) => {
        logger.warn('UDP 数据通道建立失败（UDP 穿透将不可用）:', error.message);
        // UDP 通道失败不阻断启动
      }),
    ]);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.connected && this.authenticated) {
        const heartbeatMsg: HeartbeatMessage = createMessage(MessageType.HEARTBEAT, {
          timestamp: Date.now(),
        });
        this.sendMessage(heartbeatMsg);
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
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

  private calculateReconnectDelay(): number {
    const baseDelay = this.config.reconnectInterval;
    const maxDelay = 60000;
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
    return delay + Math.random() * 1000;
  }

  /**
   * 处理控制消息（仅控制消息，数据通过 DataChannel 传输）
   */
  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());
      const msgType = message.type;

      switch (msgType) {
        case MessageType.AUTH_RESP:
        case MessageType.REGISTER_RESP:
        case MessageType.HEARTBEAT_RESP:
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

  private handleResponse(message: any): void {
    const pending = this.pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);
      pending.resolve(message);
    }
  }

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

  sendMessage(message: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    logger.error('无法发送消息: 未连接');
    return false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.dataChannel.destroy();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.authenticated = false;
  }

  destroy(): void {
    this.disconnect();
    for (const { timeout } of this.pendingRequests.values()) {
      clearTimeout(timeout);
    }
    this.pendingRequests.clear();
    this.removeAllListeners();
  }
}
