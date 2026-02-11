/**
 * @module control-handler
 * @description 控制通道处理器模块，负责处理客户端通过 WebSocket 控制通道发送的各类控制消息。
 * 包括认证、端口注册/注销、心跳以及断开连接等消息的处理逻辑。
 */

import { WebSocket } from 'ws';
import {
  MessageType,
  createMessage,
  AuthMessage,
  RegisterMessage,
  HeartbeatMessage,
  UnregisterMessage,
  ServerConfig,
  logger,
} from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';
import { UnifiedProxyHandler } from './unified-proxy.js';

/**
 * 控制通道处理器
 *
 * 处理客户端通过 WebSocket 控制通道发送的各类控制消息，包括：
 * - 客户端认证（AUTH）
 * - 端口注册（REGISTER）与注销（UNREGISTER）
 * - 心跳保活（HEARTBEAT）
 * - 连接断开的清理工作
 */
export class ControlHandler {
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** 服务器配置 */
  private config: ServerConfig;
  /** 统一代理处理器（同时支持 HTTP 和 WebSocket） */
  private proxyHandler: UnifiedProxyHandler;

  /**
   * 创建控制通道处理器实例
   *
   * @param sessionManager - 会话管理器，用于管理客户端会话
   * @param config - 服务器配置，包含认证令牌等信息
   * @param proxyHandler - 统一代理处理器，用于启停代理服务器
   */
  constructor(
    sessionManager: SessionManager,
    config: ServerConfig,
    proxyHandler: UnifiedProxyHandler
  ) {
    this.sessionManager = sessionManager;
    this.config = config;
    this.proxyHandler = proxyHandler;
  }

  /**
   * 处理新的 WebSocket 控制通道连接
   *
   * 为新连接创建会话，设置消息处理、关闭处理和错误处理回调，
   * 并启动 30 秒认证超时计时器。
   *
   * @param socket - 新建立的 WebSocket 连接
   */
  handleConnection(socket: WebSocket): void {
    const clientId = this.sessionManager.createSession(socket);

    logger.log(`新的控制连接来自客户端: ${clientId}`);

    // 设置消息处理器
    socket.on('message', (data: Buffer) => {
      this.handleMessage(clientId, socket, data).catch((error) => {
        logger.error(`处理来自 ${clientId} 的消息时出错:`, error);
        this.sendError(socket, `内部错误: ${error.message}`);
      });
    });

    // 设置关闭处理器
    socket.on('close', () => {
      logger.log(`控制连接已关闭: ${clientId}`);
      this.handleDisconnect(clientId);
    });

    // 设置错误处理器
    socket.on('error', (error) => {
      logger.error(`客户端 ${clientId} 的 Socket 错误:`, error);
    });

    // 设置认证超时
    const authTimeout = setTimeout(() => {
      const clientInfo = this.sessionManager.getClientInfo(clientId);
      if (clientInfo && !clientInfo.authenticated) {
        logger.log(`客户端 ${clientId} 认证超时`);
        socket.close();
      }
    }, 30000); // 30秒认证超时

    // 存储超时引用，以便在认证成功后清除
    (socket as any)._authTimeout = authTimeout;
  }

  /**
   * 处理收到的控制消息
   *
   * 解析 JSON 消息并根据消息类型分发到对应的处理方法。
   * 支持的消息类型包括：AUTH、REGISTER、UNREGISTER、HEARTBEAT。
   *
   * @param clientId - 发送消息的客户端 ID
   * @param socket - 客户端的 WebSocket 连接
   * @param data - 收到的原始消息数据
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

        case 'http_response':
          this.handleClientResponse(message.payload.connectionId, message.payload);
          break;

        case 'connection_data':
          this.handleClientData(message.payload.connectionId, Buffer.from(message.payload.data, 'base64'));
          break;

        case MessageType.CONNECTION_CLOSE:
          this.handleClientClose(message.payload.connectionId);
          break;

        default:
          logger.warn(`未知的消息类型: ${msgType}`);
      }
    } catch (error) {
      logger.error(`解析来自 ${clientId} 的消息时出错:`, error);
      this.sendError(socket, '无效的消息格式');
    }
  }

  /**
   * 处理认证消息
   *
   * 验证客户端提供的令牌是否在配置的有效令牌列表中。
   * 认证成功后清除认证超时计时器；认证失败则关闭连接。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param socket - 客户端的 WebSocket 连接
   * @param message - 收到的认证消息
   */
  private async handleAuth(clientId: string, socket: WebSocket, message: AuthMessage): Promise<void> {
    const { token } = message.payload;

    if (!token) {
      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: false,
        error: '令牌不能为空',
      }));
      socket.close();
      return;
    }

    if (!this.config.authTokens.includes(token)) {
      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: false,
        error: '无效的令牌',
      }));
      socket.close();
      return;
    }

    const authenticated = this.sessionManager.authenticateClient(clientId);
    if (authenticated) {
      // 清除认证超时
      const authTimeout = (socket as any)._authTimeout;
      if (authTimeout) {
        clearTimeout(authTimeout);
        delete (socket as any)._authTimeout;
      }

      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: true,
      }));
      logger.log(`客户端 ${clientId} 认证成功`);
    } else {
      this.sendMessage(socket, createMessage(MessageType.AUTH_RESP, {
        success: false,
        error: '认证失败',
      }));
      socket.close();
    }
  }

  /**
   * 处理端口注册消息
   *
   * 验证客户端认证状态和端口范围（1024-65535），检查端口是否已被占用，
   * 然后注册端口并启动代理服务器（同时支持 HTTP 和 WebSocket）。
   * 若启动失败则自动回滚端口注册。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param socket - 客户端的 WebSocket 连接
   * @param message - 收到的端口注册消息
   */
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

    // 验证端口
    if (remotePort < 1024 || remotePort > 65535) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '端口超出范围 (1024-65535)',
      }, message.id));
      return;
    }

    // 检查端口是否已被注册
    const existingClientId = this.sessionManager.getClientByPort(remotePort);
    if (existingClientId) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '端口已被注册',
      }, message.id));
      return;
    }

    // 注册端口
    const registered = this.sessionManager.registerPort(clientId, remotePort);
    if (!registered) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '端口注册失败',
      }, message.id));
      return;
    }

    // 启动代理服务器（同时支持 HTTP 和 WebSocket）
    try {
      await this.proxyHandler.startProxy(remotePort, clientId);

      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: true,
        remotePort,
        remoteUrl: `http://${this.config.host}:${remotePort}`,
      }, message.id));

      logger.log(`客户端 ${clientId} 注册了代理: 端口 ${remotePort} -> ${localHost || 'localhost'}:${localPort}`);
    } catch (error) {
      // 启动代理失败，回滚端口注册
      this.sessionManager.unregisterPort(clientId, remotePort);
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: `启动代理失败: ${errorMessage}`,
      }, message.id));
    }
  }

  /**
   * 处理端口注销消息
   *
   * 验证客户端认证状态和端口归属，停止代理服务器并注销端口。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param socket - 客户端的 WebSocket 连接
   * @param message - 收到的端口注销消息
   */
  private async handleUnregister(clientId: string, socket: WebSocket, message: UnregisterMessage): Promise<void> {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (!clientInfo || !clientInfo.authenticated) {
      return;
    }

    const { remotePort } = message.payload;

    // 检查端口是否属于该客户端
    if (!clientInfo.registeredPorts.has(remotePort)) {
      this.sendMessage(socket, createMessage(MessageType.REGISTER_RESP, {
        success: false,
        error: '该端口未被此客户端注册',
      }, message.id));
      return;
    }

    // 停止代理
    await this.proxyHandler.stopProxy(remotePort);

    // 注销端口
    const unregistered = this.sessionManager.unregisterPort(clientId, remotePort);
    if (unregistered) {
      logger.log(`客户端 ${clientId} 注销了端口 ${remotePort}`);
    }
  }

  /**
   * 处理心跳消息
   *
   * 更新客户端的最后心跳时间并回复心跳响应。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param socket - 客户端的 WebSocket 连接
   * @param message - 收到的心跳消息
   */
  private async handleHeartbeat(clientId: string, socket: WebSocket, message: HeartbeatMessage): Promise<void> {
    this.sessionManager.updateHeartbeat(clientId);
    this.sendMessage(socket, createMessage(MessageType.HEARTBEAT_RESP, {
      timestamp: Date.now(),
    }, message.id));
  }

  /**
   * 处理客户端断开连接
   *
   * 停止该客户端注册的所有代理服务器，并移除其会话。
   *
   * @param clientId - 断开连接的客户端唯一标识 ID
   */
  private handleDisconnect(clientId: string): void {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (clientInfo) {
      // 停止所有代理
      for (const port of clientInfo.registeredPorts) {
        this.proxyHandler.stopProxy(port).catch(logger.error);
      }
    }
    this.sessionManager.removeSession(clientId);
  }

  /**
   * 通过 WebSocket 发送消息
   *
   * 将消息对象序列化为 JSON 字符串后发送，仅在连接处于 OPEN 状态时发送。
   *
   * @param socket - 目标 WebSocket 连接
   * @param message - 需要发送的消息对象
   */
  private sendMessage(socket: WebSocket, message: any): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  /**
   * 发送错误消息
   *
   * 构造并发送一条 CONNECTION_ERROR 类型的错误消息给客户端。
   *
   * @param socket - 目标 WebSocket 连接
   * @param error - 错误描述信息
   */
  private sendError(socket: WebSocket, error: string): void {
    this.sendMessage(socket, createMessage(MessageType.CONNECTION_ERROR, {
      connectionId: '',
      error,
    }));
  }

  /**
   * 处理客户端返回的 HTTP 响应数据
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 客户端返回的 HTTP 响应数据
   */
  handleClientResponse(connectionId: string, data: any): void {
    this.proxyHandler.handleClientResponse(connectionId, data);
  }

  /**
   * 处理来自客户端的 WebSocket 数据
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 客户端发送的数据
   */
  handleClientData(connectionId: string, data: Buffer): void {
    this.proxyHandler.handleClientData(connectionId, data);
  }

  /**
   * 处理来自客户端的连接关闭请求
   *
   * @param connectionId - 需要关闭的连接唯一标识 ID
   * @param code - 可选的关闭状态码
   */
  handleClientClose(connectionId: string, code?: number): void {
    this.proxyHandler.handleClientClose(connectionId, code);
  }
}
