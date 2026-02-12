/**
 * @module handlers/unified-handler
 *
 * 统一代理连接处理器模块。
 *
 * 负责处理通过穿透隧道传输的所有协议连接。
 * TCP 类协议（HTTP/WS/TCP）作为原始字节流通过本地 TCP socket 转发，
 * UDP 通过本地 dgram socket 转发。
 * 不做协议解析，HTTP 和 WebSocket 协议由外部客户端和本地服务端到端处理。
 */

import { EventEmitter } from 'events';
import { Socket } from 'net';
import { createSocket as createUdpSocket, Socket as UdpSocket } from 'dgram';
import { Controller } from '../controller.js';
import { DataChannel } from '../data-channel.js';
import { ProxyConfig, logger, MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage } from '@feng3d/chuantou-shared';

/** UDP 本地 socket 超时时间（毫秒） */
const UDP_LOCAL_TIMEOUT = 30_000;

/**
 * 统一代理连接处理器
 *
 * 所有 TCP 类协议统一处理：收到 NEW_CONNECTION 后打开本地 TCP socket，
 * 通过二进制数据通道双向管道传输原始字节。
 * UDP 使用独立的 dgram socket 和超时管理。
 */
export class UnifiedHandler extends EventEmitter {
  private controller: Controller;
  private dataChannel: DataChannel;
  private config: ProxyConfig;

  /** 本地 TCP 连接映射表：connectionId → Socket */
  private localTcpConnections: Map<string, Socket> = new Map();

  /** 本地 UDP socket 映射表：connectionId → { socket, timer } */
  private localUdpSockets: Map<string, { socket: UdpSocket; timer: NodeJS.Timeout }> = new Map();

  /** 数据缓冲区：在 NEW_CONNECTION 到达前缓冲的数据帧 */
  private pendingDataBuffers: Map<string, Buffer[]> = new Map();

  /** 已通知关闭的连接集合，防止重复发送 CONNECTION_CLOSE */
  private closedConnections: Set<string> = new Set();

  /** 本地 socket 写入缓慢导致的背压连接集合 */
  private backedUpConnections: Set<string> = new Set();

  constructor(controller: Controller, config: ProxyConfig) {
    super();
    this.controller = controller;
    this.dataChannel = controller.getDataChannel();
    this.config = config;

    // 监听新连接通知
    this.controller.on('newConnection', (msg: NewConnectionMessage) => {
      if (msg.payload.remotePort !== this.config.remotePort) return;

      if (msg.payload.protocol === 'udp') {
        this.handleUdpConnection(msg);
      } else {
        this.handleTcpConnection(msg);
      }
    });

    // 监听数据通道的 TCP 数据
    this.dataChannel.on('data', (connectionId: string, data: Buffer) => {
      this.handleDataFromServer(connectionId, data);
    });

    // 监听数据通道的 UDP 数据
    this.dataChannel.on('udpData', (connectionId: string, data: Buffer) => {
      this.handleUdpDataFromServer(connectionId, data);
    });

    // 监听连接关闭
    this.controller.on('connectionClose', (msg: ConnectionCloseMessage) => {
      this.handleConnectionClose(msg);
    });
  }

  /**
   * 处理 TCP 类协议连接（HTTP/WS/TCP 统一处理）
   *
   * 打开本地 TCP socket，通过数据通道双向管道传输原始字节。
   */
  private handleTcpConnection(msg: NewConnectionMessage): void {
    const { connectionId, protocol, remoteAddress } = msg.payload;

    logger.log(`${protocol.toUpperCase()} 连接: ${remoteAddress} -> ${this.config.localHost || 'localhost'}:${this.config.localPort} (${connectionId})`);

    const socket = new Socket();

    socket.on('connect', () => {
      logger.log(`本地 TCP 已连接: ${connectionId}`);

      // 刷新缓冲区中的待处理数据
      const buffered = this.pendingDataBuffers.get(connectionId);
      if (buffered) {
        for (const chunk of buffered) {
          socket.write(chunk);
        }
        this.pendingDataBuffers.delete(connectionId);
      }
    });

    socket.on('data', (data: Buffer) => {
      const canContinue = this.dataChannel.sendData(connectionId, data);
      if (!canContinue) {
        socket.pause();
        const dcSocket = this.dataChannel.getTcpSocket();
        dcSocket?.once('drain', () => {
          if (!socket.destroyed) socket.resume();
        });
      }
    });

    socket.on('close', () => {
      logger.log(`本地 TCP 关闭: ${connectionId}`);
      this.notifyServerClose(connectionId);
      this.localTcpConnections.delete(connectionId);
      this.pendingDataBuffers.delete(connectionId);
      this.backedUpConnections.delete(connectionId);
    });

    socket.on('error', (error: Error) => {
      logger.error(`本地 TCP 错误 ${connectionId}:`, error.message);
      this.notifyServerClose(connectionId);
      this.localTcpConnections.delete(connectionId);
      this.pendingDataBuffers.delete(connectionId);
      this.backedUpConnections.delete(connectionId);
    });

    socket.connect({
      host: this.config.localHost || 'localhost',
      port: this.config.localPort,
    });

    this.localTcpConnections.set(connectionId, socket);
  }

  /**
   * 处理来自服务器的 TCP 数据（通过数据通道）
   */
  private handleDataFromServer(connectionId: string, data: Buffer): void {
    const socket = this.localTcpConnections.get(connectionId);
    if (socket && !socket.destroyed) {
      if (socket.connecting) {
        // socket 还在连接中，缓冲数据
        let buffer = this.pendingDataBuffers.get(connectionId);
        if (!buffer) {
          buffer = [];
          this.pendingDataBuffers.set(connectionId, buffer);
        }
        buffer.push(data);
      } else if (!socket.write(data)) {
        // 本地 socket 写入缓慢，暂停数据通道
        if (!this.backedUpConnections.has(connectionId)) {
          this.backedUpConnections.add(connectionId);
          const dcSocket = this.dataChannel.getTcpSocket();
          if (dcSocket) dcSocket.pause();

          socket.once('drain', () => {
            this.backedUpConnections.delete(connectionId);
            if (this.backedUpConnections.size === 0) {
              this.dataChannel.getTcpSocket()?.resume();
            }
          });
        }
      }
      return;
    }

    // 连接尚未建立（NEW_CONNECTION 可能还未到达），缓冲数据
    let buffer = this.pendingDataBuffers.get(connectionId);
    if (!buffer) {
      buffer = [];
      this.pendingDataBuffers.set(connectionId, buffer);
    }
    buffer.push(data);
  }

  /**
   * 处理 UDP 连接
   */
  private handleUdpConnection(msg: NewConnectionMessage): void {
    const { connectionId, remoteAddress } = msg.payload;

    logger.log(`UDP 连接: ${remoteAddress} -> ${this.config.localHost || 'localhost'}:${this.config.localPort} (${connectionId})`);

    const socket = createUdpSocket('udp4');

    socket.on('message', (data: Buffer) => {
      this.dataChannel.sendUdpData(connectionId, data);

      // 刷新超时
      const entry = this.localUdpSockets.get(connectionId);
      if (entry) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => this.cleanupUdpSocket(connectionId), UDP_LOCAL_TIMEOUT);
      }
    });

    socket.on('error', (error) => {
      logger.error(`本地 UDP 错误 ${connectionId}:`, error.message);
      this.cleanupUdpSocket(connectionId);
    });

    socket.bind(() => {
      this.localUdpSockets.set(connectionId, {
        socket,
        timer: setTimeout(() => this.cleanupUdpSocket(connectionId), UDP_LOCAL_TIMEOUT),
      });
    });
  }

  /**
   * 处理来自服务器的 UDP 数据
   */
  private handleUdpDataFromServer(connectionId: string, data: Buffer): void {
    const entry = this.localUdpSockets.get(connectionId);
    if (entry) {
      entry.socket.send(data, this.config.localPort, this.config.localHost || 'localhost');

      // 刷新超时
      clearTimeout(entry.timer);
      entry.timer = setTimeout(() => this.cleanupUdpSocket(connectionId), UDP_LOCAL_TIMEOUT);
    }
  }

  /**
   * 通知服务器连接已关闭
   */
  private notifyServerClose(connectionId: string): void {
    if (this.closedConnections.has(connectionId)) return;
    this.closedConnections.add(connectionId);

    this.controller.sendMessage(createMessage(MessageType.CONNECTION_CLOSE, { connectionId }));
  }

  /**
   * 处理来自服务器的连接关闭通知
   */
  private handleConnectionClose(msg: ConnectionCloseMessage): void {
    const { connectionId } = msg.payload;
    this.closedConnections.add(connectionId);

    // TCP 连接
    const socket = this.localTcpConnections.get(connectionId);
    if (socket) {
      socket.destroy();
      this.localTcpConnections.delete(connectionId);
      this.pendingDataBuffers.delete(connectionId);
      if (this.backedUpConnections.delete(connectionId) && this.backedUpConnections.size === 0) {
        this.dataChannel.getTcpSocket()?.resume();
      }
    }

    // UDP 连接
    this.cleanupUdpSocket(connectionId);
  }

  private cleanupUdpSocket(connectionId: string): void {
    const entry = this.localUdpSockets.get(connectionId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.socket.close();
      this.localUdpSockets.delete(connectionId);
    }
  }

  /**
   * 销毁处理器，释放所有资源
   */
  destroy(): void {
    for (const socket of this.localTcpConnections.values()) {
      socket.destroy();
    }
    this.localTcpConnections.clear();

    for (const entry of this.localUdpSockets.values()) {
      clearTimeout(entry.timer);
      entry.socket.close();
    }
    this.localUdpSockets.clear();

    this.pendingDataBuffers.clear();
    this.closedConnections.clear();
    this.backedUpConnections.clear();
    this.removeAllListeners();
  }
}
