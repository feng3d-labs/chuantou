/**
 * @module tcp-proxy
 * @description TCP 代理处理器模块，支持原始 TCP 连接代理（如 SSH、MySQL 等）。
 * 将外部 TCP 连接转发给穿透客户端，实现双向数据转发。
 */

import { Server as TcpServer, Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage, logger } from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';

/**
 * TCP 代理处理器
 *
 * 管理多个 TCP 代理服务器实例，每个代理监听一个独立端口。
 * 当外部 TCP 连接到达代理端口时，将连接信息通过控制通道转发给对应的穿透客户端。
 */
export class TcpProxyHandler {
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** TCP 代理服务器映射表，键为端口号，值为 TCP 服务器实例 */
  private proxies: Map<number, TcpServer>;

  /**
   * 用户 TCP 连接映射表
   *
   * 存储外部用户的 TCP 连接，键为连接 ID，值为用户的 Socket 实例。
   */
  private userConnections: Map<string, Socket> = new Map();

  /**
   * 端口到客户端 ID 的映射表
   *
   * 存储每个端口绑定的客户端 ID。
   */
  private portToClient: Map<number, string> = new Map();

  /**
   * 创建 TCP 代理处理器实例
   *
   * @param sessionManager - 会话管理器，用于获取客户端连接和管理连接记录
   */
  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.proxies = new Map();
  }

  /**
   * 启动 TCP 代理服务器
   *
   * 在指定端口创建并启动一个 TCP 服务器。
   * 若该端口已存在代理或端口被占用，将抛出异常。
   *
   * @param port - 代理监听的端口号
   * @param clientId - 绑定的客户端唯一标识 ID
   * @returns 代理服务器启动完成的 Promise
   * @throws 端口已存在代理或端口被占用时抛出错误
   */
  async startProxy(port: number, clientId: string): Promise<void> {
    if (this.proxies.has(port)) {
      throw new Error(`端口 ${port} 的代理已存在`);
    }

    const server = new TcpServer();

    // 处理 TCP 连接
    server.on('connection', (socket: Socket) => {
      this.handleTcpConnection(clientId, port, socket);
    });

    server.on('error', (error) => {
      logger.error(`TCP 代理在端口 ${port} 上发生错误:`, error);
    });

    return new Promise<void>((resolve, reject) => {
      server.listen(port, () => {
        logger.log(`TCP 代理正在端口 ${port} 上监听，绑定客户端 ${clientId}`);
        this.proxies.set(port, server);
        this.portToClient.set(port, clientId);
        resolve();
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用`));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * 处理外部 TCP 连接
   *
   * 当外部用户连接到 TCP 代理端口时，记录连接信息，通知穿透客户端有新连接到来，
   * 并设置数据转发、关闭和错误的事件处理。
   *
   * @param clientId - 处理该连接的客户端唯一标识 ID
   * @param port - 代理端口号
   * @param socket - 外部用户的 TCP socket 连接
   */
  private handleTcpConnection(clientId: string, port: number, socket: Socket): void {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    const remoteAddress = socket.remoteAddress || '';

    if (!clientSocket || clientSocket.readyState !== 1) { // WebSocket.OPEN
      logger.error(`客户端 ${clientId} 未连接，拒绝 TCP 连接 ${connectionId}`);
      socket.destroy();
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, remoteAddress, 'tcp');

    logger.log(`TCP 连接: ${remoteAddress}:${socket.remotePort} -> :${port} (${connectionId})`);

    // 存储用户 socket 引用
    this.userConnections.set(connectionId, socket);

    // 发送新连接消息给客户端
    const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
      connectionId,
      protocol: 'tcp',
      remoteAddress,
    });

    clientSocket.send(JSON.stringify(newConnMsg));

    // 处理来自用户的数据
    socket.on('data', (data: Buffer) => {
      this.forwardToClient(clientId, connectionId, data);
    });

    // 处理来自用户关闭
    socket.on('close', () => {
      logger.log(`用户 TCP 连接已关闭: ${connectionId}`);
      this.notifyClientClose(clientId, connectionId);
      this.cleanupConnection(connectionId);
    });

    // 处理错误
    socket.on('error', (error) => {
      logger.error(`用户 TCP 连接错误 ${connectionId}:`, error);
      this.cleanupConnection(connectionId);
    });
  }

  /**
   * 将用户数据转发到穿透客户端
   *
   * 将外部用户发送的 TCP 数据编码为 Base64 后，通过控制通道发送给穿透客户端。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 连接唯一标识 ID
   * @param data - 用户发送的原始数据
   */
  private forwardToClient(clientId: string, connectionId: string, data: Buffer): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === 1) { // WebSocket.OPEN
      clientSocket.send(JSON.stringify({
        type: 'tcp_data_resp',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 通知穿透客户端连接已关闭
   *
   * 当外部用户的 TCP 连接关闭时，向穿透客户端发送连接关闭通知消息。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 已关闭的连接唯一标识 ID
   */
  private notifyClientClose(clientId: string, connectionId: string): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === 1) { // WebSocket.OPEN
      const closeMsg: ConnectionCloseMessage = createMessage(MessageType.CONNECTION_CLOSE, {
        connectionId,
      });
      clientSocket.send(JSON.stringify(closeMsg));
    }
  }

  /**
   * 处理来自穿透客户端的 TCP 数据
   *
   * 将穿透客户端发送的数据转发给对应的外部用户 TCP 连接。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 穿透客户端发送的数据（Base64 编码）
   */
  handleClientData(connectionId: string, data: Buffer): void {
    const socket = this.userConnections.get(connectionId);
    if (socket && !socket.destroyed) {
      socket.write(data);
    }
  }

  /**
   * 处理来自穿透客户端的关闭请求
   *
   * 当穿透客户端请求关闭某个连接时，关闭对应的外部用户 TCP 连接并清理资源。
   *
   * @param connectionId - 需要关闭的连接唯一标识 ID
   */
  handleClientClose(connectionId: string): void {
    const socket = this.userConnections.get(connectionId);
    if (socket) {
      socket.destroy();
    }
    this.cleanupConnection(connectionId);
  }

  /**
   * 清理连接资源
   *
   * 从用户连接映射表和会话管理器中移除指定连接的记录。
   *
   * @param connectionId - 需要清理的连接唯一标识 ID
   */
  private cleanupConnection(connectionId: string): void {
    this.userConnections.delete(connectionId);
    this.sessionManager.removeConnection(connectionId);
  }

  /**
   * 停止指定端口的 TCP 代理服务器
   *
   * 关闭指定端口上的代理服务器并从映射表中移除。
   *
   * @param port - 需要停止的代理端口号
   * @returns 代理服务器关闭完成的 Promise
   */
  async stopProxy(port: number): Promise<void> {
    const server = this.proxies.get(port);
    if (server) {
      // 关闭所有活跃连接
      for (const [connId, socket] of this.userConnections.entries()) {
        socket.destroy();
        this.userConnections.delete(connId);
      }

      return new Promise<void>((resolve) => {
        server.close(() => {
          logger.log(`TCP 代理已在端口 ${port} 上停止`);
          this.proxies.delete(port);
          this.portToClient.delete(port);
          resolve();
        });
      });
    }
  }

  /**
   * 停止所有 TCP 代理服务器
   *
   * 并行关闭所有已启动的代理服务器。
   *
   * @returns 所有代理服务器关闭完成的 Promise
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const [port] of this.proxies) {
      stopPromises.push(this.stopProxy(port));
    }
    await Promise.all(stopPromises);
  }

  /**
   * 获取所有活跃代理的端口列表
   *
   * @returns 当前正在运行的所有代理端口号数组
   */
  getActivePorts(): number[] {
    return Array.from(this.proxies.keys());
  }
}
