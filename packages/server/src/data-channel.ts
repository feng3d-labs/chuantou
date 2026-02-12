/**
 * @module data-channel
 *
 * 服务端数据通道管理器。
 *
 * 管理穿透客户端的 TCP 数据通道和 UDP 数据通道连接。
 * TCP 数据通道用于高效传输 HTTP/WS/TCP 的原始二进制数据，
 * UDP 数据通道用于保留 UDP 语义的数据转发。
 */

import { Socket } from 'net';
import { Socket as UdpSocket, RemoteInfo } from 'dgram';
import { EventEmitter } from 'events';
import {
  parseTcpAuthFrame,
  parseUdpControlFrame,
  parseUdpDataFrame,
  writeDataFrame,
  writeUdpDataFrame,
  FrameParser,
  AUTH_RESPONSE,
  logger,
} from '@feng3d/chuantou-shared';
import { SessionManager } from './session-manager.js';

/**
 * 服务端数据通道管理器
 *
 * 管理所有客户端的 TCP 二进制数据通道和 UDP 数据通道。
 *
 * 事件：
 * - `'data'(clientId, connectionId, data)` — 收到客户端 TCP 数据帧
 * - `'udpData'(clientId, connectionId, data)` — 收到客户端 UDP 数据帧
 */
export class DataChannelManager extends EventEmitter {
  /** 客户端 TCP 数据通道：clientId → Socket */
  private tcpChannels: Map<string, Socket> = new Map();
  /** 客户端 TCP 帧解析器：clientId → FrameParser */
  private frameParsers: Map<string, FrameParser> = new Map();
  /** 客户端 UDP 地址：clientId → RemoteInfo */
  private udpClients: Map<string, RemoteInfo> = new Map();
  /** 服务端 UDP socket 引用 */
  private udpSocket: UdpSocket | null = null;
  /** 会话管理器 */
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    super();
    this.sessionManager = sessionManager;
  }

  /**
   * 设置 UDP socket 引用
   */
  setUdpSocket(socket: UdpSocket): void {
    this.udpSocket = socket;
  }

  /**
   * 处理新的 TCP 数据通道连接
   *
   * 解析认证帧，验证 clientId，建立关联。
   *
   * @param socket - 新的 TCP 连接
   * @param initialData - 包含认证帧的初始数据
   */
  handleNewTcpConnection(socket: Socket, initialData: Buffer): void {
    const clientId = parseTcpAuthFrame(initialData);

    if (!clientId) {
      logger.error('数据通道认证帧解析失败');
      socket.write(AUTH_RESPONSE.FAILURE);
      socket.destroy();
      return;
    }

    // 验证 clientId 是否为已认证的客户端
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (!clientInfo || !clientInfo.authenticated) {
      logger.error(`数据通道认证失败: 客户端 ${clientId} 未认证`);
      socket.write(AUTH_RESPONSE.FAILURE);
      socket.destroy();
      return;
    }

    // 关闭旧的数据通道（如果存在）
    const oldSocket = this.tcpChannels.get(clientId);
    if (oldSocket) {
      oldSocket.destroy();
      this.frameParsers.get(clientId)?.reset();
    }

    // 建立新的数据通道 — error handler 必须最先注册
    socket.on('error', (error) => {
      logger.error(`客户端 ${clientId} 数据通道错误:`, error.message);
      this.tcpChannels.delete(clientId);
      this.frameParsers.delete(clientId);
    });

    socket.write(AUTH_RESPONSE.SUCCESS);
    this.tcpChannels.set(clientId, socket);

    const parser = new FrameParser();
    this.frameParsers.set(clientId, parser);

    parser.on('frame', (connectionId: string, data: Buffer) => {
      this.emit('data', clientId, connectionId, data);
    });

    socket.on('data', (chunk: Buffer) => {
      parser.push(chunk);
    });

    socket.on('close', () => {
      logger.log(`客户端 ${clientId} 数据通道已关闭`);
      this.tcpChannels.delete(clientId);
      this.frameParsers.delete(clientId);
    });

    logger.log(`客户端 ${clientId} 数据通道已建立`);
  }

  /**
   * 处理 UDP 消息
   *
   * 区分控制帧（注册/保活）和数据帧。
   *
   * @param msg - 收到的 UDP 数据包
   * @param rinfo - 发送方地址信息
   */
  handleUdpMessage(msg: Buffer, rinfo: RemoteInfo): void {
    // 尝试解析为控制帧
    const control = parseUdpControlFrame(msg);
    if (control) {
      if (control.type === 'register') {
        this.handleUdpRegister(control.clientId, rinfo);
      }
      // keepalive 只需更新地址
      if (control.type === 'keepalive') {
        this.udpClients.set(control.clientId, rinfo);
      }
      return;
    }

    // 尝试解析为数据帧
    const frame = parseUdpDataFrame(msg);
    if (frame) {
      // 查找此连接所属的客户端
      // 通过遍历已注册的 UDP 客户端，匹配发送方地址
      for (const [clientId, clientRinfo] of this.udpClients) {
        if (clientRinfo.address === rinfo.address && clientRinfo.port === rinfo.port) {
          this.emit('udpData', clientId, frame.connectionId, frame.data);
          return;
        }
      }
      logger.warn(`收到未知来源的 UDP 数据帧: ${rinfo.address}:${rinfo.port}`);
    }
  }

  private handleUdpRegister(clientId: string, rinfo: RemoteInfo): void {
    const clientInfo = this.sessionManager.getClientInfo(clientId);
    if (!clientInfo || !clientInfo.authenticated) {
      logger.error(`UDP 注册失败: 客户端 ${clientId} 未认证`);
      return;
    }

    this.udpClients.set(clientId, rinfo);

    // 发送确认
    if (this.udpSocket) {
      this.udpSocket.send(AUTH_RESPONSE.SUCCESS, rinfo.port, rinfo.address);
    }

    logger.log(`客户端 ${clientId} UDP 通道已注册 (${rinfo.address}:${rinfo.port})`);
  }

  /**
   * 通过 TCP 数据通道发送数据帧给客户端
   *
   * @param clientId - 目标客户端 ID
   * @param connectionId - 连接 ID
   * @param data - 要发送的原始数据
   * @returns 是否发送成功
   */
  sendToClient(clientId: string, connectionId: string, data: Buffer): boolean {
    const socket = this.tcpChannels.get(clientId);
    if (socket && !socket.destroyed) {
      socket.write(writeDataFrame(connectionId, data));
      return true;
    }
    return false;
  }

  /**
   * 通过 UDP 通道发送数据帧给客户端
   *
   * @param clientId - 目标客户端 ID
   * @param connectionId - 连接 ID
   * @param data - 要发送的原始数据
   * @returns 是否发送成功
   */
  sendUdpToClient(clientId: string, connectionId: string, data: Buffer): boolean {
    const clientRinfo = this.udpClients.get(clientId);
    if (clientRinfo && this.udpSocket) {
      const frame = writeUdpDataFrame(connectionId, data);
      this.udpSocket.send(frame, clientRinfo.port, clientRinfo.address);
      return true;
    }
    return false;
  }

  /**
   * 检查客户端是否已建立 TCP 数据通道
   */
  hasDataChannel(clientId: string): boolean {
    const socket = this.tcpChannels.get(clientId);
    return !!socket && !socket.destroyed;
  }

  /**
   * 检查客户端是否已注册 UDP 通道
   */
  hasUdpChannel(clientId: string): boolean {
    return this.udpClients.has(clientId);
  }

  /**
   * 移除客户端的所有数据通道
   */
  removeClient(clientId: string): void {
    const socket = this.tcpChannels.get(clientId);
    if (socket) {
      socket.destroy();
      this.tcpChannels.delete(clientId);
    }
    this.frameParsers.delete(clientId);
    this.udpClients.delete(clientId);
  }

  /**
   * 清理所有数据通道
   */
  clear(): void {
    for (const socket of this.tcpChannels.values()) {
      socket.destroy();
    }
    this.tcpChannels.clear();
    this.frameParsers.clear();
    this.udpClients.clear();
  }
}
