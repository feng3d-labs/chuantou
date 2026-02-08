import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ClientInfo, ConnectionInfo, DEFAULT_CONFIG } from '@feng3d/zhuanfa-shared';

/**
 * 会话管理器 - 管理所有连接的客户端
 */
export class SessionManager {
  private clients: Map<string, ClientInfo>;
  private socketToClientId: Map<WebSocket, string>;
  private heartbeatInterval: number;
  private sessionTimeout: number;
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(heartbeatInterval: number = DEFAULT_CONFIG.HEARTBEAT_INTERVAL, sessionTimeout: number = DEFAULT_CONFIG.SESSION_TIMEOUT) {
    this.clients = new Map();
    this.socketToClientId = new Map();
    this.heartbeatInterval = heartbeatInterval;
    this.sessionTimeout = sessionTimeout;
    this.startHeartbeatCheck();
  }

  /**
   * 创建新会话
   */
  createSession(socket: WebSocket): string {
    const clientId = uuidv4();
    const clientInfo: ClientInfo = {
      id: clientId,
      authenticated: false,
      registeredPorts: new Set(),
      connections: new Map(),
    };
    this.clients.set(clientId, clientInfo);
    this.socketToClientId.set(socket, clientId);
    return clientId;
  }

  /**
   * 获取客户端ID
   */
  getClientId(socket: WebSocket): string | undefined {
    return this.socketToClientId.get(socket);
  }

  /**
   * 获取客户端socket
   */
  getClientSocket(clientId: string): WebSocket | undefined {
    for (const [socket, id] of this.socketToClientId.entries()) {
      if (id === clientId) {
        return socket;
      }
    }
    return undefined;
  }

  /**
   * 获取客户端信息
   */
  getClientInfo(clientId: string): ClientInfo | undefined {
    return this.clients.get(clientId);
  }

  /**
   * 认证客户端
   */
  authenticateClient(clientId: string): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      client.authenticated = true;
      client.authenticatedAt = Date.now();
      return true;
    }
    return false;
  }

  /**
   * 注册端口
   */
  registerPort(clientId: string, port: number): boolean {
    const client = this.clients.get(clientId);
    if (!client || !client.authenticated) {
      return false;
    }
    // 检查端口是否已被其他客户端注册
    for (const [id, info] of this.clients.entries()) {
      if (id !== clientId && info.registeredPorts.has(port)) {
        return false;
      }
    }
    client.registeredPorts.add(port);
    return true;
  }

  /**
   * 注销端口
   */
  unregisterPort(clientId: string, port: number): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      return client.registeredPorts.delete(port);
    }
    return false;
  }

  /**
   * 获取注册该端口的客户端ID
   */
  getClientByPort(port: number): string | undefined {
    for (const [id, info] of this.clients.entries()) {
      if (info.registeredPorts.has(port)) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * 添加连接
   */
  addConnection(clientId: string, connectionId: string, remoteAddress: string, protocol: 'http' | 'websocket'): void {
    const client = this.clients.get(clientId);
    if (client) {
      const connectionInfo: ConnectionInfo = {
        id: connectionId,
        remoteAddress,
        protocol,
        createdAt: Date.now(),
      };
      client.connections.set(connectionId, connectionInfo);
    }
  }

  /**
   * 移除连接
   */
  removeConnection(connectionId: string): void {
    for (const client of this.clients.values()) {
      client.connections.delete(connectionId);
    }
  }

  /**
   * 移除会话
   */
  removeSession(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      // 清理所有连接
      client.connections.clear();
      client.registeredPorts.clear();
    }
    this.clients.delete(clientId);
    // 删除socket映射
    for (const [socket, id] of this.socketToClientId.entries()) {
      if (id === clientId) {
        this.socketToClientId.delete(socket);
        break;
      }
    }
  }

  /**
   * 移除socket会话
   */
  removeSessionBySocket(socket: WebSocket): void {
    const clientId = this.socketToClientId.get(socket);
    if (clientId) {
      this.removeSession(clientId);
    }
  }

  /**
   * 更新心跳时间
   */
  updateHeartbeat(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  }

  /**
   * 获取所有已认证客户端
   */
  getAuthenticatedClients(): string[] {
    const result: string[] = [];
    for (const [id, info] of this.clients.entries()) {
      if (info.authenticated) {
        result.push(id);
      }
    }
    return result;
  }

  /**
   * 获取所有已注册端口
   */
  getAllRegisteredPorts(): Map<number, string> {
    const result = new Map<number, string>();
    for (const [id, info] of this.clients.entries()) {
      for (const port of info.registeredPorts) {
        result.set(port, id);
      }
    }
    return result;
  }

  /**
   * 启动心跳检查
   */
  private startHeartbeatCheck(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, info] of this.clients.entries()) {
        if (info.authenticated && info.lastHeartbeat) {
          const elapsed = now - info.lastHeartbeat;
          if (elapsed > this.sessionTimeout) {
            console.log(`Session ${id} timeout, removing...`);
            const socket = this.getClientSocket(id);
            if (socket) {
              socket.close();
            }
            this.removeSession(id);
          }
        }
      }
    }, this.heartbeatInterval);
  }

  /**
   * 停止心跳检查
   */
  stopHeartbeatCheck(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): { totalClients: number; authenticatedClients: number; totalConnections: number; totalPorts: number } {
    let authenticatedClients = 0;
    let totalConnections = 0;
    let totalPorts = 0;

    for (const info of this.clients.values()) {
      if (info.authenticated) {
        authenticatedClients++;
      }
      totalConnections += info.connections.size;
      totalPorts += info.registeredPorts.size;
    }

    return {
      totalClients: this.clients.size,
      authenticatedClients,
      totalConnections,
      totalPorts,
    };
  }

  /**
   * 清理所有会话
   */
  clear(): void {
    this.stopHeartbeatCheck();
    this.clients.clear();
    this.socketToClientId.clear();
  }
}
