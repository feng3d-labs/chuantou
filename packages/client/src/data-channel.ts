/**
 * @module data-channel
 *
 * 客户端数据通道模块。
 *
 * 管理与服务端的 TCP 二进制数据通道和 UDP 数据通道连接。
 * TCP 数据通道用于高效传输 HTTP/WS/TCP 的原始二进制数据，
 * UDP 数据通道用于保留 UDP 语义的数据转发。
 */

import { Socket } from 'net';
import { createSocket as createUdpSocket, Socket as UdpSocket } from 'dgram';
import { EventEmitter } from 'events';
import {
  writeTcpAuthFrame,
  writeDataFrame,
  writeUdpRegisterFrame,
  writeUdpKeepaliveFrame,
  writeUdpDataFrame,
  parseUdpDataFrame,
  FrameParser,
  logger,
} from '@feng3d/chuantou-shared';

/** UDP 保活间隔（毫秒） */
const UDP_KEEPALIVE_INTERVAL = 15_000;

/**
 * 客户端数据通道
 *
 * 管理与服务端的 TCP 数据通道和 UDP 数据通道。
 *
 * 事件：
 * - `'data'(connectionId, data)` — 收到服务端 TCP 数据帧
 * - `'udpData'(connectionId, data)` — 收到服务端 UDP 数据帧
 * - `'connected'` — TCP 数据通道已连接
 * - `'disconnected'` — TCP 数据通道已断开
 */
export class DataChannel extends EventEmitter {
  private tcpSocket: Socket | null = null;
  private udpSocket: UdpSocket | null = null;
  private frameParser: FrameParser | null = null;
  private udpKeepaliveTimer: NodeJS.Timeout | null = null;
  private clientId: string = '';
  private serverHost: string = '';
  private serverPort: number = 0;

  /**
   * 建立 TCP 数据通道
   *
   * @param serverHost - 服务端地址
   * @param serverPort - 服务端端口（与控制端口相同）
   * @param clientId - 服务端分配的客户端 ID
   */
  async connectTcp(serverHost: string, serverPort: number, clientId: string): Promise<void> {
    this.clientId = clientId;
    this.serverHost = serverHost;
    this.serverPort = serverPort;

    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();

      socket.on('connect', () => {
        // 发送认证帧
        socket.write(writeTcpAuthFrame(clientId));
      });

      // 等待认证响应（1 字节）
      let authenticated = false;
      socket.once('data', (data: Buffer) => {
        if (data[0] === 0x01) {
          authenticated = true;
          this.tcpSocket = socket;

          // 设置帧解析器
          this.frameParser = new FrameParser();
          this.frameParser.on('frame', (connectionId: string, frameData: Buffer) => {
            this.emit('data', connectionId, frameData);
          });

          // 后续数据走帧解析器
          socket.on('data', (chunk: Buffer) => {
            this.frameParser!.push(chunk);
          });

          // 如果认证响应后有额外数据，也推入解析器
          if (data.length > 1) {
            this.frameParser.push(data.subarray(1));
          }

          logger.log('TCP 数据通道已建立');
          this.emit('connected');
          resolve();
        } else {
          reject(new Error('TCP 数据通道认证失败'));
          socket.destroy();
        }
      });

      socket.on('close', () => {
        if (authenticated) {
          logger.log('TCP 数据通道已断开');
          this.tcpSocket = null;
          this.frameParser = null;
          this.emit('disconnected');
        }
      });

      socket.on('error', (error) => {
        if (!authenticated) {
          reject(error);
        } else {
          logger.error('TCP 数据通道错误:', error.message);
        }
      });

      socket.connect({ host: serverHost, port: serverPort });
    });
  }

  /**
   * 建立 UDP 数据通道
   *
   * @param serverHost - 服务端地址
   * @param serverPort - 服务端端口（与控制端口相同）
   * @param clientId - 服务端分配的客户端 ID
   */
  async connectUdp(serverHost: string, serverPort: number, clientId: string): Promise<void> {
    this.clientId = clientId;
    this.serverHost = serverHost;
    this.serverPort = serverPort;

    return new Promise<void>((resolve, reject) => {
      const socket = createUdpSocket('udp4');

      socket.on('error', (error) => {
        logger.error('UDP 数据通道错误:', error.message);
        reject(error);
      });

      socket.bind(() => {
        // 发送注册帧
        const registerFrame = writeUdpRegisterFrame(clientId);
        socket.send(registerFrame, serverPort, serverHost);

        // 等待确认
        const timeout = setTimeout(() => {
          reject(new Error('UDP 注册超时'));
          socket.close();
        }, 5000);

        socket.once('message', (msg) => {
          clearTimeout(timeout);

          if (msg[0] === 0x01) {
            this.udpSocket = socket;

            // 设置数据接收
            socket.on('message', (data: Buffer) => {
              const frame = parseUdpDataFrame(data);
              if (frame) {
                this.emit('udpData', frame.connectionId, frame.data);
              }
            });

            // 启动保活
            this.udpKeepaliveTimer = setInterval(() => {
              if (this.udpSocket) {
                const keepalive = writeUdpKeepaliveFrame(clientId);
                this.udpSocket.send(keepalive, serverPort, serverHost);
              }
            }, UDP_KEEPALIVE_INTERVAL);

            logger.log('UDP 数据通道已建立');
            resolve();
          } else {
            reject(new Error('UDP 注册失败'));
            socket.close();
          }
        });
      });
    });
  }

  /**
   * 通过 TCP 数据通道发送数据帧
   *
   * @param connectionId - 连接 ID
   * @param data - 要发送的原始数据
   * @returns 是否发送成功
   */
  sendData(connectionId: string, data: Buffer): boolean {
    if (this.tcpSocket && !this.tcpSocket.destroyed) {
      return this.tcpSocket.write(writeDataFrame(connectionId, data));
    }
    return false;
  }

  /**
   * 获取 TCP 数据通道 socket（用于 drain 背压处理）
   */
  getTcpSocket(): Socket | null {
    return this.tcpSocket && !this.tcpSocket.destroyed ? this.tcpSocket : null;
  }

  /**
   * 通过 UDP 数据通道发送数据帧
   *
   * @param connectionId - 连接 ID
   * @param data - 要发送的原始数据
   * @returns 是否发送成功
   */
  sendUdpData(connectionId: string, data: Buffer): boolean {
    if (this.udpSocket) {
      const frame = writeUdpDataFrame(connectionId, data);
      this.udpSocket.send(frame, this.serverPort, this.serverHost);
      return true;
    }
    return false;
  }

  /** TCP 数据通道是否已连接 */
  get isTcpConnected(): boolean {
    return !!this.tcpSocket && !this.tcpSocket.destroyed;
  }

  /** UDP 数据通道是否已连接 */
  get isUdpConnected(): boolean {
    return !!this.udpSocket;
  }

  /**
   * 销毁数据通道，释放所有资源
   */
  destroy(): void {
    if (this.tcpSocket) {
      this.tcpSocket.destroy();
      this.tcpSocket = null;
    }

    if (this.frameParser) {
      this.frameParser.reset();
      this.frameParser = null;
    }

    if (this.udpKeepaliveTimer) {
      clearInterval(this.udpKeepaliveTimer);
      this.udpKeepaliveTimer = null;
    }

    if (this.udpSocket) {
      this.udpSocket.close();
      this.udpSocket = null;
    }

    this.removeAllListeners();
  }
}
