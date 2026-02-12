/**
 * @module session-manager
 * @description 会话管理模块，负责管理所有连接的客户端会话。
 * 提供客户端的创建、认证、端口注册、连接跟踪、心跳检测和会话清理等功能。
 */

import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ClientInfo, ConnectionInfo, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';

/**
 * 会话管理器
 *
 * 管理所有连接的客户端会话，包括：
 * - 创建和销毁客户端会话
 * - 客户端认证和端口注册
 * - 连接的添加和移除跟踪
 * - 定时心跳检测，自动清除超时会话
 * - 统计信息汇总
 */
export class SessionManager {
  /** 客户端信息映射表，键为客户端 ID */
  private clients: Map<string, ClientInfo>;
  /** WebSocket 到客户端 ID 的映射表 */
  private socketToClientId: Map<WebSocket, string>;
  /** 心跳检测间隔时间（毫秒） */
  private heartbeatInterval: number;
  /** 会话超时时间（毫秒） */
  private sessionTimeout: number;
  /** 心跳检测定时器 */
  private heartbeatTimer?: NodeJS.Timeout;

  /**
   * 创建会话管理器实例
   *
   * @param heartbeatInterval - 心跳检测间隔时间（毫秒），默认使用 {@link DEFAULT_CONFIG.HEARTBEAT_INTERVAL}
   * @param sessionTimeout - 会话超时时间（毫秒），默认使用 {@link DEFAULT_CONFIG.SESSION_TIMEOUT}
   */
  constructor(heartbeatInterval: number = DEFAULT_CONFIG.HEARTBEAT_INTERVAL, sessionTimeout: number = DEFAULT_CONFIG.SESSION_TIMEOUT) {
    this.clients = new Map();
    this.socketToClientId = new Map();
    this.heartbeatInterval = heartbeatInterval;
    this.sessionTimeout = sessionTimeout;
    this.startHeartbeatCheck();
  }

  /**
   * 创建新会话
   *
   * 为新连接的 WebSocket 创建一个客户端会话，分配唯一 ID 并初始化客户端信息。
   *
   * @param socket - 客户端的 WebSocket 连接
   * @returns 新创建的客户端唯一标识 ID
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
   * 获取客户端 ID
   *
   * 根据 WebSocket 连接查找对应的客户端 ID。
   *
   * @param socket - 客户端的 WebSocket 连接
   * @returns 对应的客户端 ID；若未找到则返回 `undefined`
   */
  getClientId(socket: WebSocket): string | undefined {
    return this.socketToClientId.get(socket);
  }

  /**
   * 获取客户端 WebSocket 连接
   *
   * 根据客户端 ID 查找对应的 WebSocket 连接。
   *
   * @param clientId - 客户端唯一标识 ID
   * @returns 对应的 WebSocket 连接；若未找到则返回 `undefined`
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
   *
   * 根据客户端 ID 查找并返回完整的客户端信息。
   *
   * @param clientId - 客户端唯一标识 ID
   * @returns 对应的 {@link ClientInfo} 客户端信息；若未找到则返回 `undefined`
   */
  getClientInfo(clientId: string): ClientInfo | undefined {
    return this.clients.get(clientId);
  }

  /**
   * 认证客户端
   *
   * 将指定客户端标记为已认证状态，并记录认证时间。
   *
   * @param clientId - 客户端唯一标识 ID
   * @returns 认证是否成功；若客户端不存在则返回 `false`
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
   *
   * 为已认证的客户端注册一个远程端口。注册前会检查端口是否已被其他客户端占用。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param port - 需要注册的远程端口号
   * @returns 注册是否成功；客户端未认证或端口已被占用时返回 `false`
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
   *
   * 从指定客户端的已注册端口列表中移除一个端口。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param port - 需要注销的远程端口号
   * @returns 注销是否成功；客户端不存在或端口未注册时返回 `false`
   */
  unregisterPort(clientId: string, port: number): boolean {
    const client = this.clients.get(clientId);
    if (client) {
      return client.registeredPorts.delete(port);
    }
    return false;
  }

  /**
   * 获取注册指定端口的客户端 ID
   *
   * 遍历所有客户端，查找注册了指定端口的客户端。
   *
   * @param port - 需要查询的端口号
   * @returns 注册该端口的客户端 ID；若无客户端注册该端口则返回 `undefined`
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
   * 添加连接记录
   *
   * 为指定客户端记录一个新的活跃连接。
   *
   * @param clientId - 客户端唯一标识 ID
   * @param connectionId - 连接唯一标识 ID
   * @param remoteAddress - 远程连接的 IP 地址
   * @param protocol - 连接协议类型
   */
  addConnection(clientId: string, connectionId: string, remoteAddress: string, protocol: 'http' | 'websocket' | 'tcp' | 'udp'): void {
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
   * 移除连接记录
   *
   * 从所有客户端中移除指定的连接记录。
   *
   * @param connectionId - 需要移除的连接唯一标识 ID
   */
  removeConnection(connectionId: string): void {
    for (const client of this.clients.values()) {
      client.connections.delete(connectionId);
    }
  }

  /**
   * 移除会话
   *
   * 根据客户端 ID 移除对应的会话，清理其所有连接记录、注册端口和 WebSocket 映射。
   *
   * @param clientId - 需要移除的客户端唯一标识 ID
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
   * 根据 WebSocket 连接移除会话
   *
   * 通过 WebSocket 连接查找对应的客户端 ID，并移除其会话。
   *
   * @param socket - 需要移除会话的 WebSocket 连接
   */
  removeSessionBySocket(socket: WebSocket): void {
    const clientId = this.socketToClientId.get(socket);
    if (clientId) {
      this.removeSession(clientId);
    }
  }

  /**
   * 更新心跳时间
   *
   * 更新指定客户端的最后心跳时间为当前时间，用于保持会话活跃。
   *
   * @param clientId - 客户端唯一标识 ID
   */
  updateHeartbeat(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastHeartbeat = Date.now();
    }
  }

  /**
   * 获取所有已认证客户端的 ID 列表
   *
   * 遍历所有客户端，筛选出已通过认证的客户端。
   *
   * @returns 已认证客户端的 ID 数组
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
   * 获取所有已注册端口的映射
   *
   * 遍历所有客户端，收集所有已注册的端口及其对应的客户端 ID。
   *
   * @returns 端口号到客户端 ID 的 Map 映射
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
   * 启动心跳检查定时器
   *
   * 定期检查所有已认证客户端的最后心跳时间，
   * 若超过会话超时时间则自动关闭连接并移除会话。
   */
  private startHeartbeatCheck(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, info] of this.clients.entries()) {
        if (info.authenticated && info.lastHeartbeat) {
          const elapsed = now - info.lastHeartbeat;
          if (elapsed > this.sessionTimeout) {
            console.log(`会话 ${id} 超时，正在移除...`);
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
   * 停止心跳检查定时器
   *
   * 清除心跳检测定时器，停止定期的超时检查。
   */
  stopHeartbeatCheck(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * 获取统计信息
   *
   * 汇总当前所有客户端的统计数据，包括总客户端数、已认证数、连接数和端口数。
   *
   * @returns 包含以下字段的统计对象：
   *   - `totalClients` - 总客户端数
   *   - `authenticatedClients` - 已认证客户端数
   *   - `totalConnections` - 活跃连接总数
   *   - `totalPorts` - 已注册端口总数
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
   *
   * 停止心跳检查定时器，并清除所有客户端会话和 WebSocket 映射数据。
   */
  clear(): void {
    this.stopHeartbeatCheck();
    this.clients.clear();
    this.socketToClientId.clear();
  }

  /**
   * 获取已认证客户端的会话列表
   *
   * 返回所有已认证客户端的简要信息，用于状态展示。
   *
   * @returns 会话列表数组
   */
  getSessions(): Array<{ clientId: string; connectedAt: number; registeredPorts: number[] }> {
    const result: Array<{ clientId: string; connectedAt: number; registeredPorts: number[] }> = [];
    for (const [id, info] of this.clients.entries()) {
      if (info.authenticated) {
        result.push({
          clientId: id,
          connectedAt: info.authenticatedAt ?? 0,
          registeredPorts: Array.from(info.registeredPorts),
        });
      }
    }
    return result;
  }
}
