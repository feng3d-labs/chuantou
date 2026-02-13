/**
 * @module control-handler
 *
 * 控制通道处理器模块。
 *
 * 负责处理客户端通过 WebSocket 控制通道发送的控制消息，
 * 包括认证、端口注册/注销、心跳、客户端注册/发现、以及正向穿透连接等。
 * 实际数据传输已移至独立的二进制数据通道。
 */

import { WebSocket } from 'ws';
import { Socket } from 'net';
import {
  MessageType,
  createMessage,
  AuthMessage,
  RegisterMessage,
  HeartbeatMessage,
  UnregisterMessage,
  ServerConfig,
  logger,
  ClientRegisterMessage,
  GetClientListMessage,
  ConnectRequestMessage,
  AcceptConnectionMessage,
  RejectConnectionMessage,
} from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';
import { UnifiedProxyHandler } from './unified-proxy.js';
import { DataChannelManager } from '../data-channel.js';

/**
 * 正向穿透会话信息
 */
interface ForwardSession {
  id: string;
  fromClientId: string;
  toClientId: string;
  targetPort: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'rejected' | 'closed' | 'connected';
  /** 桥接器引用（用于清理） */
  bridge?: ForwardBridge;
}

/**
 * 客户端注册信息（正向穿透模式）
 */
interface RegisteredClient {
  id: string;
  socket: WebSocket;
  description?: string;
  registeredAt: number;
  lastHeartbeat: number;
}

/**
 * 正向穿透桥接器
 *
 * 在两个客户端的数据通道之间建立双向数据转发。
 * 当客户端A请求连接客户端B的某个端口时，服务端创建此桥接器。
 */
class ForwardBridge {
  private sessionId: string;
  private fromClientId: string;
  private toClientId: string;
  private targetPort: number;
  private dataChannelManager: DataChannelManager;
  private controlHandler: ControlHandler;

  // 连接到目标客户端本地端口的 socket
  private targetSocket?: Socket;

  constructor(
    sessionId: string,
    fromClientId: string,
    toClientId: string,
    targetPort: number,
    dataChannelManager: DataChannelManager,
    controlHandler: ControlHandler,
  ) {
    this.sessionId = sessionId;
    this.fromClientId = fromClientId;
    this.toClientId = toClientId;
    this.targetPort = targetPort;
    this.dataChannelManager = dataChannelManager;
    this.controlHandler = controlHandler;
  }

  /**
   * 启动桥接
   *
   * 通知目标客户端建立到目标端口的连接，然后开始双向转发。
   */
  async start(): Promise<void> {
    // 通知目标客户端接受连接并建立到目标端口的连接
    const targetClient = this.controlHandler.getRegisteredClient(this.toClientId);
    if (!targetClient) {
      logger.error(`目标客户端 ${this.toClientId} 不存在`);
      return;
    }

    // 发送 PROXY_TARGET_PORT 消息给目标客户端，要求其连接目标端口
    const proxyTargetMsg = createMessage(MessageType.PROXY_TARGET_PORT, {
      sessionId: this.sessionId,
      targetPort: this.targetPort,
    });

    targetClient.socket.send(JSON.stringify(proxyTargetMsg));
    logger.log(`已通知客户端 ${this.toClientId} 连接到端口 ${this.targetPort} (会话: ${this.sessionId})`);

    // 等待目标客户端确认连接
    // 实际的连接建立由 handleTargetPortConnected 处理
  }

  /**
   * 目标客户端已连接到目标端口
   *
   * 开始双向数据转发。
   */
  onTargetConnected(): void {
    logger.log(`目标客户端 ${this.toClientId} 已连接到端口 ${this.targetPort}，开始数据转发 (会话: ${this.sessionId})`);

    // 发送连接建立消息给发起方
    const fromClient = this.controlHandler.getRegisteredClient(this.fromClientId);
    if (fromClient && fromClient.socket.readyState === WebSocket.OPEN) {
      const establishedMsg = createMessage(MessageType.CONNECTION_ESTABLISHED, {
        sessionId: this.sessionId,
        relayAddr: {
          host: '', // 不需要，直接通过数据通道转发
          port: 0,
        },
      });
      fromClient.socket.send(JSON.stringify(establishedMsg));
    }
  }

  /**
   * 转发数据从客户端A到客户端B
   */
  forwardFromSource(data: Buffer): boolean {
    return this.dataChannelManager.sendToClient(this.toClientId, this.sessionId, data);
  }

  /**
   * 转发数据从客户端B到客户端A
   */
  forwardFromTarget(data: Buffer): boolean {
    return this.dataChannelManager.sendToClient(this.fromClientId, this.sessionId, data);
  }

  /**
   * 清理桥接
   */
  destroy(): void {
    if (this.targetSocket && !this.targetSocket.destroyed) {
      this.targetSocket.destroy();
    }
    logger.log(`桥接已销毁: ${this.sessionId}`);
  }
}

/**
 * 控制通道处理器
 *
 * 处理客户端通过 WebSocket 控制通道发送的控制消息：
 * - 客户端认证（AUTH）
 * - 端口注册（REGISTER）与注销（UNREGISTER）- 反向代理模式
 * - 心跳保活（HEARTBEAT）
 * - 连接关闭（CONNECTION_CLOSE）
 * - 客户端注册（CLIENT_REGISTER）- 正向穿透模式
 * - 获取客户端列表（GET_CLIENT_LIST）
 * - 连接请求（CONNECT_REQUEST）
 * - 接受/拒绝连接（ACCEPT_CONNECTION / REJECT_CONNECTION）
 * - 目标端口连接确认（TARGET_PORT_CONNECTED）- 正向穿透数据通道
 */
export class ControlHandler {
  private sessionManager: SessionManager;
  private config: ServerConfig;
  private proxyHandler: UnifiedProxyHandler;
  private dataChannelManager: DataChannelManager;

  // 正向穿透模式：注册的客户端映射
  private registeredClients = new Map<string, RegisteredClient>();

  // 正向穿透会话
  private forwardSessions = new Map<string, ForwardSession>();

  constructor(
    sessionManager: SessionManager,
    config: ServerConfig,
    proxyHandler: UnifiedProxyHandler,
    dataChannelManager: DataChannelManager,
  ) {
    this.sessionManager = sessionManager;
    this.config = config;
    this.proxyHandler = proxyHandler;
    this.dataChannelManager = dataChannelManager;

    // 监听数据通道事件，处理正向穿透数据转发
    this.setupDataChannelForwarding();
  }

  /**
   * 设置数据通道转发
   *
   * 监听数据通道的数据事件，在正向穿透会话的两个客户端之间转发数据。
   */
  private setupDataChannelForwarding(): void {
    this.dataChannelManager.on('data', (clientId: string, connectionId: string, data: Buffer) => {
      // 检查是否为正向穿透会话
      const session = this.forwardSessions.get(connectionId);
      if (session && session.status === 'connected' && session.bridge) {
        // 确定数据来源方向
        if (clientId === session.fromClientId) {
          // 从发起方到目标方
          session.bridge.forwardFromSource(data);
        } else if (clientId === session.toClientId) {
          // 从目标方到发起方
          session.bridge.forwardFromTarget(data);
        }
      }
    });
  }

  /**
   * 处理新的 WebSocket 控制通道连接
   */
  handleConnection(socket: WebSocket): void {
    const clientId = this.sessionManager.createSession(socket);

    logger.log(`新的控制连接来自客户端: ${clientId}`);

    socket.on('message', (data: Buffer) => {
      this.handleMessage(clientId, socket, data).catch((error) => {
        logger.error(`处理来自 ${clientId} 的消息时出错:`, error);
        this.sendError(socket, `内部错误: ${error.message}`);
      });
    });

    socket.on('close', () => {
      logger.log(`控制连接已关闭: ${clientId}`);
      this.handleDisconnect(clientId);
    });

    socket.on('error', (error) => {
      logger.error(`客户端 ${clientId} 的 Socket 错误:`, error);
    });

    // 30 秒认证超时
    const authTimeout = setTimeout(() => {
      const clientInfo = this.sessionManager.getClientInfo(clientId);
      if (clientInfo && !clientInfo.authenticated) {
        logger.log(`客户端 ${clientId} 认证超时`);
        socket.close();
      }
    }, 30000);

    (socket as any)._authTimeout = authTimeout;
  }

  /**
   * 处理控制消息
   *
   * 仅处理控制消息，数据传输由独立的二进制数据通道处理。
   */
  private async handleMessage(clientId: string, socket: WebSocket, data: Buffer): Promise<void> {
    try {
      const message = JSON.parse(data.toString());
      const msgType = message.type;

      logger.log(`收到来自 ${clientId} 的消息: ${msgType}`);

      switch (msgType) {
        case MessageType.AUTH:
          await this.handleAuth(clientId, socket, message as AuthMessage);
          break;

        case MessageType.REGISTER:
          await this.handleRegister(clientId, socket, message as RegisterMessage);
          break;

        case MessageType.UNREGISTER:
          await this.handleUnregister(clientId, socket, message as UnregisterMessage);
          break;

        case MessageType.HEARTBEAT:
          await this.handleHeartbeat(clientId, socket, message as HeartbeatMessage);
          break;

        case MessageType.CONNECTION_CLOSE:
          this.proxyHandler.handleClientClose(message.payload.connectionId);
          break;

        // 正向穿透模式消息
        case MessageType.CLIENT_REGISTER:
          await this.handleClientRegister(clientId, socket, message as ClientRegisterMessage);
          break;

        case MessageType.GET_CLIENT_LIST:
          await this.handleGetClientList(clientId, socket, message);
          break;

        case MessageType.CONNECT_REQUEST:
          await this.handleConnectRequest(clientId, socket, message as ConnectRequestMessage);
          break;

        case MessageType.ACCEPT_CONNECTION:
          await this.handleAcceptConnection(clientId, socket, message as AcceptConnectionMessage);
          break;

        case MessageType.REJECT_CONNECTION:
          await this.handleRejectConnection(clientId, socket, message as RejectConnectionMessage);
          break;

        case MessageType.TARGET_PORT_CONNECTED:
          await this.handleTargetPortConnected(clientId, socket, message);
          break;

        default:
          logger.warn(`未知的消息类型: ${msgType}`);
          this.sendError(socket, `未知的消息类型: ${msgType}`);
      }
    } catch (error) {
      logger.error(`解析来自 ${clientId} 的消息时出错:`, error);
      this.sendError(socket, '无效的消息格式');
    }
  }

  private async handleAuth(clientId: string, socket: WebSocket, message: AuthMessage): Promise<void> {
    const { token } = message.payload;

    // 如果服务端未配置认证令牌，则允许所有客户端通过认证（无认证模式）
    if (this.config.authTokens.length === 0) {
      const authenticated = this.sessionManager.authenticateClient(clientId);
      if (authenticated) {
        const authTimeout = (socket as any)._authTimeout;
        if (authTimeout) {
          clearTimeout(authTimeout);
          delete (socket as any)._authTimeout;
        }

        this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
          success: true,
          clientId,
        }, message.id));
        logger.log(`客户端 ${clientId} 认证成功（无认证模式）`);
      } else {
        this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
          success: false,
          error: '认证失败',
        }, message.id));
        socket.close();
      }
      return;
    }

    // 配置了认证令牌，则需要验证
    if (!token) {
      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: false,
        error: '令牌不能为空',
      }, message.id));
      socket.close();
      return;
    }

    if (!this.config.authTokens.includes(token)) {
      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: false,
        error: '无效的令牌',
      }, message.id));
      socket.close();
      return;
    }

    const authenticated = this.sessionManager.authenticateClient(clientId);
    if (authenticated) {
      const authTimeout = (socket as any)._authTimeout;
      if (authTimeout) {
        clearTimeout(authTimeout);
        delete (socket as any)._authTimeout;
      }

      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: true,
        clientId,
      }, message.id));
      logger.log(`客户端 ${clientId} 认证成功`);
    } else {
      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: false,
        error: '认证失败',
      }, message.id));
      socket.close();
    }
  }

  private async handleRegister(clientId: string, socket: WebSocket, message: RegisterMessage): Promise<void> {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (!clientInfo || !clientInfo.authenticated) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '未认证',
      }, message.id));
      return;
    }

    const { remotePort, localPort, localHost } = message.payload;

    if (remotePort < 1024 || remotePort > 65535) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '端口超出范围 (1024-65535)',
      }, message.id));
      return;
    }

    const existingClientId = this.sessionManager.getClientByPort(remotePort);
    if (existingClientId) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '端口已被注册',
      }, message.id));
      return;
    }

    const registered = this.sessionManager.registerPort(clientId, remotePort);
    if (!registered) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '端口注册失败',
      }, message.id));
      return;
    }

    try {
      await this.proxyHandler.startProxy(remotePort, clientId);

      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: true,
        remotePort,
        remoteUrl: `http://${this.config.host}:${remotePort}`,
      }, message.id));

      logger.log(`客户端 ${clientId} 注册了代理: 端口 ${remotePort} -> ${localHost || 'localhost'}:${localPort}`);
    } catch (error) {
      this.sessionManager.unregisterPort(clientId, remotePort);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: `启动代理失败: ${errorMessage}`,
      }, message.id));
    }
  }

  private async handleUnregister(clientId: string, socket: WebSocket, message: UnregisterMessage): Promise<void> {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (!clientInfo || !clientInfo.authenticated) {
      return;
    }

    const { remotePort } = message.payload;

    if (!clientInfo.registeredPorts.has(remotePort)) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '该端口未被此客户端注册',
      }, message.id));
      return;
    }

    await this.proxyHandler.stopProxy(remotePort);
    const unregistered = this.sessionManager.unregisterPort(clientId, remotePort);
    if (unregistered) {
      logger.log(`客户端 ${clientId} 注销了端口 ${remotePort}`);
    }
  }

  private async handleHeartbeat(clientId: string, socket: WebSocket, message: HeartbeatMessage): Promise<void> {
    this.sessionManager.updateHeartbeat(clientId);
    // 同时更新正向穿透注册的客户端心跳
    const registeredClient = this.registeredClients.get(clientId);
    if (registeredClient) {
      registeredClient.lastHeartbeat = Date.now();
    }
    this.sendMessage(socket, createMessage(MessageType.HEARTBEAT_RESP, {
      timestamp: Date.now(),
    }, message.id));
  }

  /**
   * 处理客户端注册（正向穿透模式）
   */
  private async handleClientRegister(clientId: string, socket: WebSocket, message: ClientRegisterMessage): Promise<void> {
    const { description } = message.payload;

    // 检查是否已注册
    if (this.registeredClients.has(clientId)) {
      const existing = this.registeredClients.get(clientId)!;
      existing.description = description;
      existing.lastHeartbeat = Date.now();

      this.sendMessage(socket, createMessage(MessageType.CLIENT_REGISTER_RESP, {
        success: true,
        clientId,
      }, message.id));
      logger.log(`客户端 ${clientId} 更新注册信息`);
      return;
    }

    // 新注册
    this.registeredClients.set(clientId, {
      id: clientId,
      socket,
      description,
      registeredAt: Date.now(),
      lastHeartbeat: Date.now(),
    });

    this.sendMessage(socket, createMessage(MessageType.CLIENT_REGISTER_RESP, {
      success: true,
      clientId,
    }, message.id));
    logger.log(`客户端 ${clientId} 注册成功 (${description || '无描述'})`);
  }

  /**
   * 处理获取客户端列表请求
   */
  private async handleGetClientList(clientId: string, socket: WebSocket, requestMessage: any): Promise<void> {
    const clients = Array.from(this.registeredClients.values()).map(c => ({
      id: c.id,
      description: c.description,
      registeredAt: c.registeredAt,
      lastHeartbeat: c.lastHeartbeat,
    }));

    this.sendMessage(socket, createMessage(MessageType.CLIENT_LIST, {
      clients,
    }, requestMessage.id));
    logger.log(`发送客户端列表给 ${clientId}，共 ${clients.length} 个客户端`);
  }

  /**
   * 处理连接请求（正向穿透）
   */
  private async handleConnectRequest(clientId: string, socket: WebSocket, message: ConnectRequestMessage): Promise<void> {
    const { fromClientId, toClientId, targetPort, sessionId } = message.payload;

    // 验证发起者
    if (fromClientId !== clientId) {
      this.sendMessage(socket, createMessage(MessageType.CONNECTION_ERROR, {
        connectionId: sessionId,
        error: '发起者 ID 不匹配',
      }));
      return;
    }

    // 检查目标客户端是否存在
    const targetClient = this.registeredClients.get(toClientId);
    if (!targetClient) {
      this.sendMessage(socket, createMessage(MessageType.CONNECTION_ERROR, {
        connectionId: sessionId,
        error: `目标客户端 ${toClientId} 不存在或未注册`,
      }));
      return;
    }

    // 检查目标客户端连接是否有效
    if (targetClient.socket.readyState !== WebSocket.OPEN) {
      this.sendMessage(socket, createMessage(MessageType.CONNECTION_ERROR, {
        connectionId: sessionId,
        error: '目标客户端连接已断开',
      }));
      return;
    }

    // 创建会话
    const session: ForwardSession = {
      id: sessionId,
      fromClientId,
      toClientId,
      targetPort,
      createdAt: Date.now(),
      status: 'pending',
    };
    this.forwardSessions.set(sessionId, session);

    // 通知目标客户端有入站连接
    this.sendMessage(targetClient.socket, createMessage(MessageType.INCOMING_CONNECTION, {
      sessionId,
      fromClientId,
      targetPort,
    }));

    logger.log(`会话 ${sessionId}: ${fromClientId} 请求连接到 ${toClientId}:${targetPort}`);
  }

  /**
   * 处理接受连接
   */
  private async handleAcceptConnection(clientId: string, socket: WebSocket, message: AcceptConnectionMessage): Promise<void> {
    const { sessionId } = message.payload;

    const session = this.forwardSessions.get(sessionId);
    if (!session) {
      logger.warn(`会话 ${sessionId} 不存在`);
      return;
    }

    if (session.toClientId !== clientId) {
      logger.warn(`客户端 ${clientId} 无权接受会话 ${sessionId}`);
      return;
    }

    session.status = 'accepted';

    // 创建桥接器
    const bridge = new ForwardBridge(
      sessionId,
      session.fromClientId,
      session.toClientId,
      session.targetPort,
      this.dataChannelManager,
      this,
    );
    session.bridge = bridge;

    // 启动桥接
    await bridge.start();

    logger.log(`会话 ${sessionId} 已被 ${clientId} 接受，桥接器已创建`);
  }

  /**
   * 处理目标端口已连接消息
   *
   * 当目标客户端成功连接到目标端口后，发送此消息确认。
   */
  private async handleTargetPortConnected(clientId: string, socket: WebSocket, message: any): Promise<void> {
    const { sessionId } = message.payload;

    const session = this.forwardSessions.get(sessionId);
    if (!session) {
      logger.warn(`会话 ${sessionId} 不存在`);
      return;
    }

    if (session.toClientId !== clientId) {
      logger.warn(`客户端 ${clientId} 无权确认会话 ${sessionId}`);
      return;
    }

    session.status = 'connected';

    // 通知桥接器目标已连接
    if (session.bridge) {
      session.bridge.onTargetConnected();
    }

    logger.log(`会话 ${sessionId}: 目标端口 ${session.targetPort} 已连接`);
  }

  /**
   * 处理拒绝连接
   */
  private async handleRejectConnection(clientId: string, socket: WebSocket, message: RejectConnectionMessage): Promise<void> {
    const { sessionId, reason } = message.payload;

    const session = this.forwardSessions.get(sessionId);
    if (!session) {
      logger.warn(`会话 ${sessionId} 不存在`);
      return;
    }

    if (session.toClientId !== clientId) {
      logger.warn(`客户端 ${clientId} 无权拒绝会话 ${sessionId}`);
      return;
    }

    session.status = 'rejected';

    // 通知发起者连接被拒绝
    const fromClient = this.registeredClients.get(session.fromClientId);
    if (fromClient && fromClient.socket.readyState === WebSocket.OPEN) {
      this.sendMessage(fromClient.socket, createMessage(MessageType.CONNECTION_ERROR, {
        connectionId: sessionId,
        error: reason || '连接被目标客户端拒绝',
      }));
    }

    logger.log(`会话 ${sessionId} 被 ${clientId} 拒绝: ${reason || '无原因'}`);

    // 清理会话和桥接器
    if (session.bridge) {
      session.bridge.destroy();
    }
    this.forwardSessions.delete(sessionId);
  }

  /**
   * 获取正向穿透会话
   */
  getForwardSession(sessionId: string): ForwardSession | undefined {
    return this.forwardSessions.get(sessionId);
  }

  /**
   * 获取注册的客户端
   */
  getRegisteredClient(clientId: string): RegisteredClient | undefined {
    return this.registeredClients.get(clientId);
  }

  private handleDisconnect(clientId: string): void {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (clientInfo) {
      for (const port of clientInfo.registeredPorts) {
        this.proxyHandler.stopProxy(port).catch(logger.error);
      }
    }

    // 清理正向穿透注册
    this.registeredClients.delete(clientId);

    // 清理相关的会话和桥接器
    for (const [sessionId, session] of this.forwardSessions) {
      if (session.fromClientId === clientId || session.toClientId === clientId) {
        if (session.bridge) {
          session.bridge.destroy();
        }
        this.forwardSessions.delete(sessionId);
      }
    }

    this.sessionManager.removeSession(clientId);
  }

  private sendMessage(socket: WebSocket, message: any): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private sendError(socket: WebSocket, error: string): void {
    this.sendMessage(socket, createMessage(MessageType.CONNECTION_ERROR, {
      connectionId: '',
      error,
    }));
  }
}
