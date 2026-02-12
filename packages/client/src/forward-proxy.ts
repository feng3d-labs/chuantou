/**
 * @module forward-proxy
 *
 * 正向穿透代理模块。
 *
 * 实现从本地端口到远程客户端端口的穿透功能。
 * 用户连接本地端口 → 通过中继服务器 → 连接到目标客户端的指定端口。
 */

import { EventEmitter } from 'events';
import { createServer as createTcpServer, Server as TcpServer, Socket } from 'net';
import {
  MessageType,
  createMessage,
  logger,
  ClientRegisterMessage,
  GetClientListMessage,
  ClientListMessage,
  ConnectRequestMessage,
  IncomingConnectionMessage,
  AcceptConnectionMessage,
  ConnectionEstablishedMessage,
  ConnectionErrorMessage,
} from '@feng3d/chuantou-shared';
import { Controller } from './controller.js';

/**
 * 正向穿透代理配置
 */
export interface ForwardProxyEntry {
  /** 本地监听端口 */
  localPort: number;
  /** 目标客户端 ID */
  targetClientId: string;
  /** 目标端口 */
  targetPort: number;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 正向穿透代理类
 *
 * 管理从本地端口到远程客户端的穿透映射。
 */
export class ForwardProxy extends EventEmitter {
  private controller: Controller;
  private proxies = new Map<number, ForwardProxyEntry>();
  private servers = new Map<number, TcpServer>();
  private activeConnections = new Map<string, Socket>();

  // 待处理的入站连接 (sessionId -> socket)
  private pendingConnections = new Map<string, Socket>();

  // 会话信息 (sessionId -> { localPort, targetPort, targetClientId })
  private sessions = new Map<string, {
    localPort: number;
    targetPort: number;
    targetClientId: string;
    localSocket?: Socket;
    relaySocket?: Socket;
  }>();

  constructor(controller: Controller) {
    super();
    this.controller = controller;

    // 监听控制通道消息
    this.setupMessageHandlers();
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    // 监听入站连接请求
    this.controller.on('controlMessage', (message: any) => {
      if (message.type === MessageType.INCOMING_CONNECTION) {
        this.handleIncomingConnection(message as IncomingConnectionMessage);
      } else if (message.type === MessageType.CONNECTION_ESTABLISHED) {
        this.handleConnectionEstablished(message as ConnectionEstablishedMessage);
      } else if (message.type === MessageType.CONNECTION_ERROR) {
        this.handleConnectionError(message as ConnectionErrorMessage);
      }
    });
  }

  /**
   * 注册客户端（正向穿透模式）
   */
  async registerAsClient(description?: string): Promise<void> {
    if (!this.controller.isAuthenticated()) {
      throw new Error('请先连接并认证到服务器');
    }

    const message: ClientRegisterMessage = createMessage(MessageType.CLIENT_REGISTER, {
      clientId: this.controller.getClientId(),
      description,
    });

    const response = await this.controller.sendRequest<any>(message);
    if (!response.payload.success) {
      throw new Error(`注册失败: ${response.payload.error}`);
    }

    logger.log(`客户端注册成功: ${this.controller.getClientId()} (${description || '无描述'})`);
  }

  /**
   * 获取在线客户端列表
   */
  async getClientList(): Promise<ClientListMessage['payload']> {
    if (!this.controller.isAuthenticated()) {
      throw new Error('请先连接并认证到服务器');
    }

    const message: GetClientListMessage = createMessage(MessageType.GET_CLIENT_LIST, {});
    const response = await this.controller.sendRequest<ClientListMessage>(message);
    return response.payload;
  }

  /**
   * 添加正向穿透代理
   */
  async addProxy(entry: ForwardProxyEntry): Promise<void> {
    const { localPort, targetClientId, targetPort } = entry;

    // 检查端口是否已被使用
    if (this.proxies.has(localPort)) {
      throw new Error(`本地端口 ${localPort} 已被使用`);
    }

    // 检查端口是否可用
    const isAvailable = await this.isPortAvailable(localPort);
    if (!isAvailable) {
      throw new Error(`本地端口 ${localPort} 已被占用`);
    }

    // 创建 TCP 服务器监听本地端口
    const server = createTcpServer();

    server.on('connection', (socket: Socket) => {
      this.handleLocalConnection(socket, localPort, targetClientId, targetPort);
    });

    server.on('error', (error: Error) => {
      logger.error(`代理服务器 ${localPort} 错误:`, error);
    });

    // 启动服务器
    await new Promise<void>((resolve, reject) => {
      server.listen(localPort, '127.0.0.1', () => {
        logger.log(`正向代理已启动: 本地 :${localPort} → ${targetClientId}:${targetPort}`);
        resolve();
      });
      server.on('error', reject);
    });

    this.proxies.set(localPort, entry);
    this.servers.set(localPort, server);

    this.emit('proxyAdded', entry);
  }

  /**
   * 移除正向穿透代理
   */
  async removeProxy(localPort: number): Promise<void> {
    const entry = this.proxies.get(localPort);
    if (!entry) {
      throw new Error(`本地端口 ${localPort} 没有代理映射`);
    }

    const server = this.servers.get(localPort);
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      this.servers.delete(localPort);
    }

    this.proxies.delete(localPort);
    logger.log(`正向代理已移除: 本地 :${localPort}`);

    this.emit('proxyRemoved', localPort);
  }

  /**
   * 移除指定目标的所有代理
   */
  async removeByTarget(targetClientId: string): Promise<number> {
    const toRemove: number[] = [];
    for (const [localPort, entry] of this.proxies) {
      if (entry.targetClientId === targetClientId) {
        toRemove.push(localPort);
      }
    }

    for (const localPort of toRemove) {
      await this.removeProxy(localPort);
    }

    return toRemove.length;
  }

  /**
   * 获取所有代理
   */
  getProxies(): ForwardProxyEntry[] {
    return Array.from(this.proxies.values());
  }

  /**
   * 检查端口是否可用
   */
  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const tester = createTcpServer()
        .once('error', () => resolve(false))
        .once('listening', () => {
          tester.close();
          resolve(true);
        })
        .listen(port, '127.0.0.1');
    });
  }

  /**
   * 处理本地连接
   */
  private async handleLocalConnection(
    localSocket: Socket,
    localPort: number,
    targetClientId: string,
    targetPort: number
  ): Promise<void> {
    const sessionId = this.generateSessionId();

    logger.log(`本地连接 :${localPort} → 请求连接到 ${targetClientId}:${targetPort} (会话: ${sessionId})`);

    // 保存待处理的连接
    this.pendingConnections.set(sessionId, localSocket);

    // 保存会话信息
    this.sessions.set(sessionId, {
      localPort,
      targetPort,
      targetClientId,
      localSocket,
    });

    // 向服务端发送连接请求
    try {
      const message: ConnectRequestMessage = createMessage(MessageType.CONNECT_REQUEST, {
        fromClientId: this.controller.getClientId(),
        toClientId: targetClientId,
        targetPort,
        sessionId,
      });

      await this.controller.sendRequest<any>(message, 30000);
      logger.log(`连接请求已发送: ${sessionId}`);
    } catch (error) {
      logger.error(`发送连接请求失败:`, error);
      localSocket.destroy();
      this.pendingConnections.delete(sessionId);
      this.sessions.delete(sessionId);
    }

    // 处理本地连接关闭
    localSocket.on('close', () => {
      this.cleanupSession(sessionId);
    });

    localSocket.on('error', (error) => {
      logger.error(`本地连接错误 (${sessionId}):`, error);
      this.cleanupSession(sessionId);
    });
  }

  /**
   * 处理入站连接请求（来自服务端）
   */
  private async handleIncomingConnection(message: IncomingConnectionMessage): Promise<void> {
    const { sessionId, fromClientId, targetPort } = message.payload;

    logger.log(`收到入站连接请求: ${sessionId} 来自 ${fromClientId} → :${targetPort}`);

    // 自动接受连接
    try {
      const acceptMessage: AcceptConnectionMessage = createMessage(MessageType.ACCEPT_CONNECTION, {
        sessionId,
      });

      await this.controller.sendRequest<any>(acceptMessage);
      logger.log(`已接受入站连接: ${sessionId}`);
    } catch (error) {
      logger.error(`接受入站连接失败:`, error);
    }
  }

  /**
   * 处理连接已建立消息
   */
  private async handleConnectionEstablished(message: ConnectionEstablishedMessage): Promise<void> {
    const { sessionId, relayAddr } = message.payload;

    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`会话 ${sessionId} 不存在`);
      return;
    }

    logger.log(`连接已建立: ${sessionId}，准备建立数据通道`);

    // 连接到中继服务器的数据通道
    // 这里通过数据通道建立连接
    const dataChannel = this.controller.getDataChannel();

    // 创建到中继服务器的 TCP 连接用于数据转发
    const net = await import('net');
    const relaySocket = net.createConnection({
      host: relayAddr.host,
      port: relayAddr.port,
    });

    relaySocket.on('connect', () => {
      logger.log(`中继数据通道已连接: ${sessionId}`);

      // 发送会话 ID 魔数前缀，标识这个连接属于哪个会话
      const sessionIdBuffer = Buffer.from(sessionId, 'utf-8');
      const lengthPrefix = Buffer.alloc(2);
      lengthPrefix.writeUInt16BE(sessionIdBuffer.length);
      relaySocket.write(Buffer.concat([lengthPrefix, sessionIdBuffer]));

      // 开始双向转发
      this.startForwarding(session.localSocket!, relaySocket, sessionId);
      this.startForwarding(relaySocket, session.localSocket!, sessionId);

      session.relaySocket = relaySocket;
    });

    relaySocket.on('error', (error) => {
      logger.error(`中继连接错误 (${sessionId}):`, error);
      this.cleanupSession(sessionId);
    });

    relaySocket.on('close', () => {
      logger.log(`中继连接已关闭: ${sessionId}`);
      this.cleanupSession(sessionId);
    });
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(message: ConnectionErrorMessage): void {
    const { connectionId: sessionId, error } = message.payload;

    logger.error(`连接错误 (${sessionId}): ${error}`);

    const session = this.sessions.get(sessionId);
    if (session?.localSocket) {
      session.localSocket.destroy();
    }

    this.cleanupSession(sessionId);
  }

  /**
   * 开始双向转发
   */
  private startForwarding(source: Socket, destination: Socket, sessionId: string): void {
    source.on('data', (data) => {
      if (destination.writable) {
        destination.write(data);
      }
    });

    source.on('close', () => {
      destination.end();
    });

    source.on('error', () => {
      destination.destroy();
    });
  }

  /**
   * 清理会话
   */
  private cleanupSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.localSocket && !session.localSocket.destroyed) {
        session.localSocket.destroy();
      }
      if (session.relaySocket && !session.relaySocket.destroyed) {
        session.relaySocket.destroy();
      }
      this.sessions.delete(sessionId);
    }
    this.pendingConnections.delete(sessionId);
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * 销毁所有代理
   */
  async destroy(): Promise<void> {
    // 关闭所有服务器
    for (const [localPort, server] of this.servers) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // 清理所有会话
    for (const sessionId of this.sessions.keys()) {
      this.cleanupSession(sessionId);
    }

    this.proxies.clear();
    this.servers.clear();
    this.removeAllListeners();
  }
}
