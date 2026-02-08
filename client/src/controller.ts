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
} from '@feng3d/zhuanfa-shared';
import { Config } from './config.js';

/**
 * 控制器 - 管理与服务器的连接
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

  constructor(config: Config) {
    super();
    this.config = config;
  }

  /**
   * 连接到服务器
   */
  async connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      console.log(`Connecting to ${this.config.serverUrl}...`);

      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on('open', async () => {
        console.log('Connected to server');
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
        console.log('Connection closed');
        this.connected = false;
        this.authenticated = false;
        this.stopHeartbeat();
        this.emit('disconnected');
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        if (!this.connected) {
          reject(error);
        }
      });
    });
  }

  /**
   * 认证
   */
  private async authenticate(): Promise<void> {
    console.log('Authenticating...');

    const authMsg: AuthMessage = createMessage(MessageType.AUTH, {
      token: this.config.token,
    });

    const response = await this.sendRequest<AuthRespMessage>(authMsg);
    if (!response.payload.success) {
      throw new Error(`Authentication failed: ${response.payload.error}`);
    }

    this.authenticated = true;
    console.log('Authenticated successfully');
    this.emit('authenticated');
  }

  /**
   * 发送心跳
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
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 安排重连
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return; // 已经安排了重连
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = this.calculateReconnectDelay();
    console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.connect().catch((error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Reconnect failed:', errorMessage);
        this.scheduleReconnect();
      });
    }, delay);
  }

  /**
   * 计算重连延迟（指数退避）
   */
  private calculateReconnectDelay(): number {
    const baseDelay = this.config.reconnectInterval;
    const maxDelay = 60000; // 最大60秒
    const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
    // 添加随机抖动
    return delay + Math.random() * 1000;
  }

  /**
   * 处理消息
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
          console.warn(`Unknown message type: ${msgType}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Error handling message:', errorMessage);
    }
  }

  /**
   * 处理响应消息
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
   * 发送请求并等待响应
   */
  sendRequest<T>(message: any, timeout: number = 30000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(message.id);
        reject(new Error('Request timeout'));
      }, timeout);

      this.pendingRequests.set(message.id, { resolve, reject, timeout: timer });
      this.sendMessage(message);
    });
  }

  /**
   * 发送消息
   */
  sendMessage(message: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    console.error('Cannot send message: not connected');
    return false;
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * 检查是否已认证
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  /**
   * 断开连接
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
   * 清理
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
