/**
 * @module control-handler
 *
 * 控制通道处理器模块。
 *
 * 负责处理客户端通过 WebSocket 控制通道发送的控制消息，
 * 包括认证、端口注册/注销、心跳以及连接关闭等。
 * 实际数据传输已移至独立的二进制数据通道。
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
 * 处理客户端通过 WebSocket 控制通道发送的控制消息：
 * - 客户端认证（AUTH）
 * - 端口注册（REGISTER）与注销（UNREGISTER）
 * - 心跳保活（HEARTBEAT）
 * - 连接关闭（CONNECTION_CLOSE）
 */
export class ControlHandler {
  private sessionManager: SessionManager;
  private config: ServerConfig;
  private proxyHandler: UnifiedProxyHandler;

  constructor(
    sessionManager: SessionManager,
    config: ServerConfig,
    proxyHandler: UnifiedProxyHandler,
  ) {
    this.sessionManager = sessionManager;
    this.config = config;
    this.proxyHandler = proxyHandler;
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
    this.sendMessage(socket, createMessage(MessageType.HEARTBEAT_RESP, {
      timestamp: Date.now(),
    }, message.id));
  }

  private handleDisconnect(clientId: string): void {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (clientInfo) {
      for (const port of clientInfo.registeredPorts) {
        this.proxyHandler.stopProxy(port).catch(logger.error);
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
