/**
 * @module forward-proxy
 *
 * 正向穿透代理模块。
 *
 * 实现从本地端口到远程客户端端口的穿透功能。
 * 用户连接本地端口 → 通过中继服务器数据通道 → 连接到目标客户端的指定端口。
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
  ProxyTargetPortMessage,
  TargetPortConnectedMessage,
  ForwardProxyEntry,
} from '@feng3d/chuantou-shared';
import { Controller } from './controller.js';

// 重新导出 ForwardProxyEntry 供其他模块使用
export type { ForwardProxyEntry };

/**
 * 会话信息
 */
interface ForwardSession {
  sessionId: string;
  localPort: number;
  targetPort: number;
  targetClientId: string;
  localSocket?: Socket;
  targetSocket?: Socket;
  status: 'pending' | 'connected' | 'closed';
  role: 'initiator' | 'target'; // initiator: 发起方, target: 目标方
}

/**
 * 正向穿透代理类
 *
 * 管理从本地端口到远程客户端的穿透映射。
 * 支持两种角色：
 * - 发起方: 用户连接本地端口，数据转发到目标客户端
 * - 目标方: 接受来自其他客户端的连接，转发到本地服务
 */
export class ForwardProxy extends EventEmitter {
  private controller: Controller;
  private proxies = new Map<number, ForwardProxyEntry>();
  private servers = new Map<number, TcpServer>();

  // 会话信息 (sessionId -> ForwardSession)
  private sessions = new Map<string, ForwardSession>();

  constructor(controller: Controller) {
    super();
    this.controller = controller;

    // 监听控制通道消息
    this.setupMessageHandlers();

    // 监听数据通道消息
    this.setupDataChannelHandlers();
  }

  /**
   * 设置消息处理器
   */
  private setupMessageHandlers(): void {
    // 监听控制通道消息
    this.controller.on('controlMessage', (message: any) => {
      switch (message.type) {
        case MessageType.INCOMING_CONNECTION:
          this.handleIncomingConnection(message as IncomingConnectionMessage);
          break;
        case MessageType.CONNECTION_ESTABLISHED:
          this.handleConnectionEstablished(message as ConnectionEstablishedMessage);
          break;
        case MessageType.CONNECTION_ERROR:
          this.handleConnectionError(message as ConnectionErrorMessage);
          break;
        case MessageType.PROXY_TARGET_PORT:
          this.handleProxyTargetPort(message as ProxyTargetPortMessage);
          break;
      }
    });
  }

  /**
   * 设置数据通道处理器
   */
  private setupDataChannelHandlers(): void {
    const dataChannel = this.controller.getDataChannel();

    // 监听来自服务端的数据帧
    dataChannel.on('data', (sessionId: string, data: Buffer) => {
      this.handleDataChannelData(sessionId, data);
    });
  }

  /**
   * 处理数据通道数据
   */
  private handleDataChannelData(sessionId: string, data: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`收到未知会话 ${sessionId} 的数据`);
      return;
    }

    if (session.status !== 'connected') {
      logger.warn(`会话 ${sessionId} 未连接，丢弃数据`);
      return;
    }

    if (session.role === 'initiator' && session.targetSocket) {
      // 数据从目标客户端 -> 本地目标端口
      if (session.targetSocket.writable) {
        session.targetSocket.write(data);
      }
    } else if (session.role === 'target') {
      // 数据从发起方 -> 本地服务
      const socket = session.targetSocket;
      if (socket && socket.writable) {
        socket.write(data);
      }
    }
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
   * 处理本地连接（发起方）
   */
  private async handleLocalConnection(
    localSocket: Socket,
    localPort: number,
    targetClientId: string,
    targetPort: number
  ): Promise<void> {
    const sessionId = this.generateSessionId();

    logger.log(`本地连接 :${localPort} → 请求连接到 ${targetClientId}:${targetPort} (会话: ${sessionId})`);

    // 创建会话
    const session: ForwardSession = {
      sessionId,
      localPort,
      targetPort,
      targetClientId,
      localSocket,
      status: 'pending',
      role: 'initiator',
    };
    this.sessions.set(sessionId, session);

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
      this.sessions.delete(sessionId);
      return;
    }

    // 处理本地连接关闭
    localSocket.on('close', () => {
      logger.log(`本地连接已关闭: ${sessionId}`);
      this.cleanupSession(sessionId);
    });

    localSocket.on('error', (error) => {
      logger.error(`本地连接错误 (${sessionId}):`, error);
      this.cleanupSession(sessionId);
    });

    // 将本地连接的数据通过数据通道发送
    localSocket.on('data', (data: Buffer) => {
      if (session.status === 'connected') {
        const dataChannel = this.controller.getDataChannel();
        dataChannel.sendData(sessionId, data);
      }
    });
  }

  /**
   * 处理入站连接请求（目标方）
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
   * 处理连接已建立消息（发起方）
   */
  private async handleConnectionEstablished(message: ConnectionEstablishedMessage): Promise<void> {
    const { sessionId } = message.payload;

    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn(`会话 ${sessionId} 不存在`);
      return;
    }

    if (session.role !== 'initiator') {
      return; // 只处理发起方
    }

    logger.log(`连接已建立: ${sessionId}`);

    session.status = 'connected';

    // 开始将本地 socket 数据通过数据通道转发
    if (session.localSocket) {
      // 重新绑定数据处理器（因为之前绑定在 pending 状态时不发送）
      const dataChannel = this.controller.getDataChannel();

      session.localSocket.on('data', (data: Buffer) => {
        if (session.status === 'connected') {
          dataChannel.sendData(sessionId, data);
        }
      });
    }
  }

  /**
   * 处理代理目标端口请求（目标方）
   */
  private async handleProxyTargetPort(message: ProxyTargetPortMessage): Promise<void> {
    const { sessionId, targetPort } = message.payload;

    logger.log(`收到代理目标端口请求: ${sessionId} → :${targetPort}`);

    // 创建到本地目标端口的连接
    const targetSocket = new Socket();

    try {
      await new Promise<void>((resolve, reject) => {
        targetSocket.on('connect', () => resolve());
        targetSocket.on('error', reject);
        targetSocket.connect(targetPort, '127.0.0.1');
      });

      logger.log(`已连接到本地端口 ${targetPort} (会话: ${sessionId})`);

      // 创建会话
      const session: ForwardSession = {
        sessionId,
        localPort: targetPort,
        targetPort,
        targetClientId: '',
        targetSocket,
        status: 'connected',
        role: 'target',
      };
      this.sessions.set(sessionId, session);

      // 将目标端口的数据通过数据通道转发
      targetSocket.on('data', (data: Buffer) => {
        const dataChannel = this.controller.getDataChannel();
        dataChannel.sendData(sessionId, data);
      });

      targetSocket.on('close', () => {
        logger.log(`目标端口连接已关闭: ${sessionId}`);
        this.cleanupSession(sessionId);
      });

      targetSocket.on('error', (error) => {
        logger.error(`目标端口连接错误 (${sessionId}):`, error);
        this.cleanupSession(sessionId);
      });

      // 通知服务端已连接
      const connectedMessage: TargetPortConnectedMessage = createMessage(MessageType.TARGET_PORT_CONNECTED, {
        sessionId,
      });
      await this.controller.sendRequest<any>(connectedMessage);

    } catch (error) {
      logger.error(`连接到本地端口 ${targetPort} 失败:`, error);
      // 发送错误消息
      const errorMsg = createMessage(MessageType.CONNECTION_ERROR, {
        connectionId: sessionId,
        error: `无法连接到本地端口 ${targetPort}`,
      });
      await this.controller.sendRequest<any>(errorMsg);
    }
  }

  /**
   * 处理连接错误
   */
  private handleConnectionError(message: ConnectionErrorMessage): void {
    const { connectionId: sessionId, error } = message.payload;

    logger.error(`连接错误 (${sessionId}): ${error}`);

    this.cleanupSession(sessionId);
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
      if (session.targetSocket && !session.targetSocket.destroyed) {
        session.targetSocket.destroy();
      }
      session.status = 'closed';
      this.sessions.delete(sessionId);
    }
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
