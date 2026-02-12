/**
 * @module unified-proxy
 *
 * 统一代理处理器模块。
 *
 * 在指定端口上同时支持 HTTP、WebSocket、TCP 和 UDP 代理。
 * 所有 TCP 类协议（HTTP/WS/TCP）作为原始字节流转发，不做协议解析，
 * HTTP 协议由外部客户端和本地服务端到端处理。
 * UDP 使用基于会话的转发，30 秒超时自动清理。
 */

import { Server as TcpServer, Socket, createServer } from 'net';
import { createSocket as createUdpSocket, Socket as UdpSocket } from 'dgram';
import { WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, NewConnectionMessage, ConnectionCloseMessage, Protocol, logger } from '@feng3d/chuantou-shared';
import { SessionManager } from '../session-manager.js';
import { DataChannelManager } from '../data-channel.js';

/** UDP 会话超时时间（毫秒） */
const UDP_SESSION_TIMEOUT = 30_000;

/**
 * 代理服务器实例
 */
interface ProxyServerInstance {
  /** TCP 服务器（处理 HTTP/WS/TCP） */
  tcpServer: TcpServer;
  /** UDP socket（处理 UDP） */
  udpSocket: UdpSocket;
  /** 端口号 */
  port: number;
}

/**
 * UDP 会话
 */
interface UdpSession {
  /** 连接 ID */
  connectionId: string;
  /** 外部 UDP 客户端地址 */
  address: string;
  /** 外部 UDP 客户端端口 */
  port: number;
  /** 超时定时器 */
  timer: NodeJS.Timeout;
}

/**
 * 统一代理处理器
 *
 * 管理多个代理服务器实例，每个实例监听一个独立端口，
 * 同时支持 TCP 类协议和 UDP 协议。
 * 数据通过独立的二进制数据通道传输，不经过 WebSocket 控制通道。
 */
export class UnifiedProxyHandler {
  private sessionManager: SessionManager;
  private dataChannelManager: DataChannelManager;
  private proxies: Map<number, ProxyServerInstance> = new Map();

  /** 外部 TCP 连接映射表：connectionId → Socket */
  private userSockets: Map<string, Socket> = new Map();

  /** UDP 会话映射表：sessionKey (addr:port) → UdpSession */
  private udpSessions: Map<string, UdpSession> = new Map();

  /** connectionId → UDP 会话 key，用于反向查找 */
  private udpConnectionToSession: Map<string, { port: number; sessionKey: string }> = new Map();

  constructor(sessionManager: SessionManager, dataChannelManager: DataChannelManager) {
    this.sessionManager = sessionManager;
    this.dataChannelManager = dataChannelManager;

    // 监听来自客户端的 TCP 数据帧
    this.dataChannelManager.on('data', (_clientId: string, connectionId: string, data: Buffer) => {
      this.handleDataFromClient(connectionId, data);
    });

    // 监听来自客户端的 UDP 数据帧
    this.dataChannelManager.on('udpData', (_clientId: string, connectionId: string, data: Buffer) => {
      this.handleUdpDataFromClient(connectionId, data);
    });
  }

  /**
   * 启动代理服务器
   *
   * 在指定端口创建 TCP 服务器和 UDP socket，同时支持所有协议。
   */
  async startProxy(port: number, clientId: string): Promise<void> {
    if (this.proxies.has(port)) {
      throw new Error(`端口 ${port} 的代理已存在`);
    }

    const tcpServer = createServer({ pauseOnConnect: true });
    const udpSocket = createUdpSocket('udp4');

    // TCP 连接处理
    tcpServer.on('connection', (socket: Socket) => {
      this.handleNewTcpConnection(clientId, port, socket);
    });

    tcpServer.on('error', (error) => {
      logger.error(`代理在端口 ${port} 上 TCP 错误:`, error);
    });

    // UDP 消息处理
    udpSocket.on('message', (msg: Buffer, rinfo) => {
      this.handleUdpMessage(clientId, port, msg, rinfo);
    });

    udpSocket.on('error', (error) => {
      logger.error(`代理在端口 ${port} 上 UDP 错误:`, error);
    });

    return new Promise<void>((resolve, reject) => {
      tcpServer.listen(port, () => {
        const actualPort = (tcpServer.address() as { port: number }).port;

        udpSocket.bind(actualPort, () => {
          logger.log(`代理正在端口 ${actualPort} 上监听（TCP + UDP），绑定客户端 ${clientId}`);
          this.proxies.set(actualPort, { tcpServer, udpSocket, port: actualPort });
          resolve();
        });

        udpSocket.on('error', (error) => {
          tcpServer.close();
          reject(error);
        });
      });

      tcpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`端口 ${port} 已被占用`));
        } else {
          reject(error);
        }
      });
    });
  }

  /**
   * 处理新的 TCP 连接
   *
   * 读取首字节检测协议类型（仅用于日志），然后建立字节管道。
   */
  private handleNewTcpConnection(clientId: string, port: number, socket: Socket): void {
    const connectionId = uuidv4();
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    const remoteAddress = socket.remoteAddress || '';

    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      socket.destroy();
      return;
    }

    // 存储外部连接
    this.userSockets.set(connectionId, socket);

    // 恢复 socket，读取首字节检测协议
    socket.once('readable', () => {
      const data = socket.read(Math.min(socket.readableLength || 1024, 1024)) as Buffer | null;

      if (!data) {
        socket.once('data', (firstData: Buffer) => {
          const protocol = this.detectProtocol(firstData);
          this.setupConnection(clientId, port, connectionId, socket, remoteAddress, protocol, firstData);
        });
        socket.resume();
        return;
      }

      const protocol = this.detectProtocol(data);
      this.setupConnection(clientId, port, connectionId, socket, remoteAddress, protocol, data);
    });
  }

  /**
   * 建立连接：发送 NEW_CONNECTION 通知，并设置双向数据管道
   */
  private setupConnection(
    clientId: string, port: number, connectionId: string, socket: Socket,
    remoteAddress: string, protocol: Protocol, initialData: Buffer,
  ): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
      socket.destroy();
      this.userSockets.delete(connectionId);
      return;
    }

    // 记录连接
    this.sessionManager.addConnection(clientId, connectionId, remoteAddress, protocol);
    logger.log(`${protocol.toUpperCase()} 连接: ${remoteAddress} -> :${port} (${connectionId})`);

    // 通过 WebSocket 控制通道发送 NEW_CONNECTION
    const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
      connectionId,
      protocol,
      remotePort: port,
      remoteAddress,
    });
    clientSocket.send(JSON.stringify(newConnMsg));

    // 恢复 socket
    socket.resume();

    // 通过数据通道发送初始数据
    this.dataChannelManager.sendToClient(clientId, connectionId, initialData);

    // 后续数据通过数据通道转发
    socket.on('data', (data: Buffer) => {
      this.dataChannelManager.sendToClient(clientId, connectionId, data);
    });

    socket.on('close', () => {
      logger.log(`连接关闭: ${connectionId}`);
      this.notifyClientClose(clientId, connectionId);
      this.cleanupConnection(connectionId);
    });

    socket.on('error', (error) => {
      logger.error(`连接错误 ${connectionId}:`, error.message);
      this.cleanupConnection(connectionId);
    });
  }

  /**
   * 检测连接协议类型（仅用于日志和统计）
   */
  private detectProtocol(data: Buffer): Protocol {
    if (data.length < 4) return 'tcp';

    const header = data.toString('ascii', 0, Math.min(data.length, 8)).toUpperCase();
    const httpMethods = ['GET', 'POST', 'PUT', 'DELET', 'HEAD', 'OPTIO', 'PATCH', 'TRACE', 'CONN'];

    for (const method of httpMethods) {
      if (header.startsWith(method)) {
        // 进一步检测是否为 WebSocket 升级请求
        const fullHeader = data.toString('ascii', 0, Math.min(data.length, 512)).toLowerCase();
        if (fullHeader.includes('upgrade: websocket')) {
          return 'websocket';
        }
        return 'http';
      }
    }

    return 'tcp';
  }

  /**
   * 处理来自客户端的 TCP 数据（通过数据通道）
   *
   * 写入到对应的外部 socket。
   */
  private handleDataFromClient(connectionId: string, data: Buffer): void {
    const socket = this.userSockets.get(connectionId);
    if (socket && !socket.destroyed) {
      socket.write(data);
    }
  }

  /**
   * 处理外部 UDP 消息
   */
  private handleUdpMessage(
    clientId: string, port: number, msg: Buffer,
    rinfo: { address: string; port: number },
  ): void {
    const sessionKey = `${rinfo.address}:${rinfo.port}`;
    let session = this.udpSessions.get(sessionKey);

    if (session) {
      // 已有会话，刷新超时
      clearTimeout(session.timer);
      session.timer = setTimeout(() => this.cleanupUdpSession(sessionKey), UDP_SESSION_TIMEOUT);

      // 转发数据到客户端
      this.dataChannelManager.sendUdpToClient(clientId, session.connectionId, msg);
    } else {
      // 新会话
      const clientSocket = this.sessionManager.getClientSocket(clientId);
      if (!clientSocket || clientSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      const connectionId = uuidv4();

      session = {
        connectionId,
        address: rinfo.address,
        port: rinfo.port,
        timer: setTimeout(() => this.cleanupUdpSession(sessionKey), UDP_SESSION_TIMEOUT),
      };

      this.udpSessions.set(sessionKey, session);
      this.udpConnectionToSession.set(connectionId, { port, sessionKey });

      // 记录连接
      this.sessionManager.addConnection(clientId, connectionId, rinfo.address, 'udp');
      logger.log(`UDP 会话: ${rinfo.address}:${rinfo.port} -> :${port} (${connectionId})`);

      // 通过 WebSocket 发送 NEW_CONNECTION
      const newConnMsg: NewConnectionMessage = createMessage(MessageType.NEW_CONNECTION, {
        connectionId,
        protocol: 'udp',
        remotePort: port,
        remoteAddress: rinfo.address,
      });
      clientSocket.send(JSON.stringify(newConnMsg));

      // 通过 UDP 数据通道转发初始数据
      this.dataChannelManager.sendUdpToClient(clientId, connectionId, msg);
    }
  }

  /**
   * 处理来自客户端的 UDP 数据（通过 UDP 数据通道）
   *
   * 回发给外部 UDP 客户端。
   */
  private handleUdpDataFromClient(connectionId: string, data: Buffer): void {
    const sessionInfo = this.udpConnectionToSession.get(connectionId);
    if (!sessionInfo) return;

    const session = this.udpSessions.get(sessionInfo.sessionKey);
    if (!session) return;

    const proxy = this.proxies.get(sessionInfo.port);
    if (!proxy) return;

    proxy.udpSocket.send(data, session.port, session.address);
  }

  /**
   * 通知客户端连接已关闭
   */
  private notifyClientClose(clientId: string, connectionId: string): void {
    const clientSocket = this.sessionManager.getClientSocket(clientId);
    if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
      const closeMsg: ConnectionCloseMessage = createMessage(MessageType.CONNECTION_CLOSE, {
        connectionId,
      });
      clientSocket.send(JSON.stringify(closeMsg));
    }
  }

  /**
   * 处理来自客户端的关闭请求
   */
  handleClientClose(connectionId: string): void {
    // TCP 连接
    const socket = this.userSockets.get(connectionId);
    if (socket) {
      socket.destroy();
      this.cleanupConnection(connectionId);
      return;
    }

    // UDP 会话
    const sessionInfo = this.udpConnectionToSession.get(connectionId);
    if (sessionInfo) {
      this.cleanupUdpSession(sessionInfo.sessionKey);
    }
  }

  private cleanupConnection(connectionId: string): void {
    this.userSockets.delete(connectionId);
    this.sessionManager.removeConnection(connectionId);
  }

  private cleanupUdpSession(sessionKey: string): void {
    const session = this.udpSessions.get(sessionKey);
    if (session) {
      clearTimeout(session.timer);
      this.udpConnectionToSession.delete(session.connectionId);
      this.sessionManager.removeConnection(session.connectionId);
    }
    this.udpSessions.delete(sessionKey);
  }

  /**
   * 停止指定端口的代理服务器
   */
  async stopProxy(port: number): Promise<void> {
    const proxy = this.proxies.get(port);
    if (!proxy) return;

    // 清理该端口的所有 TCP 连接
    for (const [connId, socket] of this.userSockets) {
      socket.destroy();
      this.userSockets.delete(connId);
    }

    // 清理该端口的所有 UDP 会话
    for (const [key, session] of this.udpSessions) {
      const info = this.udpConnectionToSession.get(session.connectionId);
      if (info && info.port === port) {
        this.cleanupUdpSession(key);
      }
    }

    return new Promise<void>((resolve) => {
      proxy.udpSocket.close(() => {
        proxy.tcpServer.close(() => {
          logger.log(`代理已在端口 ${port} 上停止`);
          this.proxies.delete(port);
          resolve();
        });
      });
    });
  }

  /**
   * 停止所有代理服务器
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
   */
  getActivePorts(): number[] {
    return Array.from(this.proxies.keys());
  }
}
