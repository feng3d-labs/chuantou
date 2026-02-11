/**
 * @module ws-proxy
 * @description WebSocket 代理处理器模块，负责在指定端口上启动 WebSocket 代理服务器。
 * 将外部 WebSocket 连接桥接到穿透客户端，实现双向实时数据转发。
 */

import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage } from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';

/**
 * WebSocket 代理处理器
 *
 * 管理多个 WebSocket 代理服务器实例，每个代理监听一个独立端口。
 * 当外部 WebSocket 连接到达代理端口时，将连接桥接到对应的穿透客户端，
 * 实现用户与客户端之间的双向实时数据转发。
 */
export class WsProxyHandler {
  /** 会话管理器实例 */
  private sessionManager: SessionManager;
  /** 代理服务器映射表，键为端口号，值为 WebSocketServer 实例 */
  private proxies: Map<number, WebSocketServer>;

  /**
   * 创建 WebSocket 代理处理器实例
   *
   * @param sessionManager - 会话管理器，用于获取客户端连接和管理连接记录
   */
  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
    this.proxies = new Map();
  }

  /**
   * 启动 WebSocket 代理服务器
   *
   * 在指定端口创建并启动一个 WebSocket 服务器，将该端口的所有连接桥接给对应客户端。
   * 若该端口已存在代理，将抛出异常。
   *
   * @param port - 代理监听的端口号
   * @param clientId - 绑定的客户端唯一标识 ID
   * @returns 代理服务器启动完成的 Promise
   * @throws 端口已存在代理时抛出错误
   */
  async startProxy(port: number, clientId: string): Promise<void> {
    if (this.proxies.has(port)) {
      throw new Error(`端口 ${port} 的 WebSocket 代理已存在`);
    }

    const server = new WebSocketServer({
      port,
      handleProtocols: (protocols: Set<string>, _request) => {
        // 接受所有协议
        const protocolArray = Array.from(protocols);
        return protocolArray.length > 0 ? protocolArray[0] : '';
      },
    });

    server.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(clientId, ws, req).catch((error) => {
        console.error(`处理 WebSocket 连接时出错:`, error);
        ws.close();
      });
    });

    server.on('error', (error) => {
      console.error(`WebSocket 代理在端口 ${port} 上发生错误:`, error);
    });

    console.log(`WebSocket 代理正在端口 ${port} 上监听，绑定客户端 ${clientId}`);
    this.proxies.set(port, server);
  }

  /**
   * 处理外部 WebSocket 连接
   *
   * 当外部用户连接到代理端口时，记录连接信息，通知穿透客户端有新连接到来，
   * 并设置消息转发、关闭和错误的事件处理。
   *
   * @param clientId - 处理该连接的客户端唯一标识 ID
   * @param userWs - 外部用户的 WebSocket 连接
   * @param req - HTTP 升级请求对象，包含请求头和 URL 等信息
   */
  private async handleConnection(clientId: string, userWs: WebSocket, req: any): Promise<void> {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);

    if (!clientSocket || clientSocket.readyState !== 1 /* OPEN */) {
      userWs.close(1011, '客户端未连接');
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(
      clientId,
      connectionId,
      req.socket.remoteAddress || '',
      'websocket'
    );

    console.log(`WebSocket 连接: ${req.url} -> 客户端 ${clientId} (${connectionId})`);

    // 存储用户WebSocket引用
    this.userConnections.set(connectionId, userWs);

    // 构建请求头
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) {
        headers[key] = Array.isArray(value) ? value.join(', ') : (value as string);
      }
    }

    // 发送新连接消息给客户端
    const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
      connectionId,
      protocol: 'websocket',
      url: req.url || '/',
      wsHeaders: headers,
    });

    clientSocket.send(JSON.stringify(newConnMsg));

    // 处理来自用户的消息
    userWs.on('message', (data: Buffer) => {
      this.forwardToClient(clientId, connectionId, data);
    });

    // 处理来自用户关闭
    userWs.on('close', (code: number, reason: Buffer) => {
      console.log(`用户 WebSocket 已关闭: ${connectionId} (${code})`);
      this.notifyClientClose(clientId, connectionId, code);
      this.cleanupConnection(connectionId);
    });

    // 处理错误
    userWs.on('error', (error) => {
      console.error(`用户 WebSocket 错误 ${connectionId}:`, error);
      this.cleanupConnection(connectionId);
    });
  }

  /**
   * 用户 WebSocket 连接映射表
   *
   * 存储外部用户的 WebSocket 连接，键为连接 ID，值为用户的 WebSocket 实例。
   */
  private userConnections: Map<string, WebSocket> = new Map();

  /**
   * 将用户消息转发到穿透客户端
   *
   * 将外部用户发送的 WebSocket 数据编码为 Base64 后，通过控制通道发送给穿透客户端。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 连接唯一标识 ID
   * @param data - 用户发送的原始数据
   */
  private forwardToClient(clientId: string, connectionId: string, data: Buffer): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === 1) {
      // 发送数据消息
      clientSocket.send(JSON.stringify({
        type: 'connection_data',
        connectionId,
        data: data.toString('base64'),
      }));
    }
  }

  /**
   * 通知穿透客户端连接已关闭
   *
   * 当外部用户的 WebSocket 连接关闭时，向穿透客户端发送连接关闭通知消息。
   *
   * @param clientId - 目标客户端唯一标识 ID
   * @param connectionId - 已关闭的连接唯一标识 ID
   * @param code - WebSocket 关闭状态码
   */
  private notifyClientClose(clientId: string, connectionId: string, code: number): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === 1) {
      const closeMsg: ConnectionCloseMessage = createMessage(MessageType.CONNECTION_CLOSE, {
        connectionId,
      });
      clientSocket.send(JSON.stringify(closeMsg));
    }
  }

  /**
   * 处理来自穿透客户端的数据
   *
   * 将穿透客户端发送的数据转发给对应的外部用户 WebSocket 连接。
   *
   * @param connectionId - 连接唯一标识 ID
   * @param data - 穿透客户端发送的数据
   */
  handleClientData(connectionId: string, data: Buffer): void {
    const userWs = this.userConnections.get(connectionId);
    if (userWs && userWs.readyState === 1) {
      userWs.send(data);
    }
  }

  /**
   * 处理来自穿透客户端的关闭请求
   *
   * 当穿透客户端请求关闭某个连接时，关闭对应的外部用户 WebSocket 连接并清理资源。
   *
   * @param connectionId - 需要关闭的连接唯一标识 ID
   * @param code - 可选的 WebSocket 关闭状态码，默认为 1000（正常关闭）
   */
  handleClientClose(connectionId: string, code?: number): void {
    const userWs = this.userConnections.get(connectionId);
    if (userWs) {
      userWs.close(code || 1000);
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
   * 停止指定端口的 WebSocket 代理服务器
   *
   * 关闭指定端口上的 WebSocket 代理服务器并从映射表中移除。
   *
   * @param port - 需要停止的代理端口号
   * @returns 代理服务器关闭完成的 Promise
   */
  async stopProxy(port: number): Promise<void> {
    const server = this.proxies.get(port);
    if (server) {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log(`WebSocket 代理已在端口 ${port} 上停止`);
          this.proxies.delete(port);
          resolve();
        });
      });
    }
  }

  /**
   * 停止所有 WebSocket 代理服务器
   *
   * 并行关闭所有已启动的 WebSocket 代理服务器。
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
   * @returns 当前正在运行的所有 WebSocket 代理端口号数组
   */
  getActivePorts(): number[] {
    return Array.from(this.proxies.keys());
  }
}
