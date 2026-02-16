/**
 * @module data-channel
 *
 * 二进制数据通道协议定义与工具。
 *
 * 定义了 TCP 数据通道和 UDP 数据通道的帧格式、魔数常量，
 * 以及帧的构建与解析工具，用于在穿透服务端与客户端之间高效传输原始二进制数据。
 */

import { EventEmitter } from 'events';

/** connectionId 的固定长度（UUID v4 字符串 36 字节） */
export const CONNECTION_ID_LENGTH = 36;

/** clientId 的固定长度（UUID v4 字符串 36 字节） */
export const CLIENT_ID_LENGTH = 36;

/** 帧长度字段的字节数 */
export const FRAME_LENGTH_SIZE = 4;

/**
 * connectionId → UTF-8 Buffer 编码缓存
 *
 * 避免每帧都重新 UTF-8 编码 36 字节的 UUID 字符串。
 */
const connectionIdBufferCache = new Map<string, Buffer>();

function getConnectionIdBuffer(connectionId: string): Buffer {
  let buf = connectionIdBufferCache.get(connectionId);
  if (!buf) {
    buf = Buffer.alloc(CONNECTION_ID_LENGTH);
    buf.write(connectionId, 0, CONNECTION_ID_LENGTH, 'utf-8');
    connectionIdBufferCache.set(connectionId, buf);
  }
  return buf;
}

/**
 * 清除 connectionId 的缓存编码（连接关闭时调用）
 */
export function clearConnectionIdBuffer(connectionId: string): void {
  connectionIdBufferCache.delete(connectionId);
}

/**
 * 数据通道魔数常量
 *
 * 用于在协议复用时区分不同类型的连接和消息。
 */
export const DATA_CHANNEL_MAGIC = {
  /** TCP 数据通道认证握手魔数 */
  TCP_AUTH: Buffer.from([0xFD, 0x01]),
  /** UDP 数据通道注册魔数 */
  UDP_REGISTER: Buffer.from([0xFD, 0x02]),
  /** UDP 保活魔数 */
  UDP_KEEPALIVE: Buffer.from([0xFD, 0x03]),
} as const;

/** TCP 认证响应 */
export const AUTH_RESPONSE = {
  SUCCESS: Buffer.from([0x01]),
  FAILURE: Buffer.from([0x00]),
} as const;

/**
 * 构建 TCP 数据通道认证帧
 *
 * @param clientId - 客户端 ID（36 字节 UUID 字符串）
 * @returns 认证帧 Buffer：[0xFD][0x01][36B clientId]
 */
export function writeTcpAuthFrame(clientId: string): Buffer {
  const buf = Buffer.alloc(2 + CLIENT_ID_LENGTH);
  DATA_CHANNEL_MAGIC.TCP_AUTH.copy(buf, 0);
  buf.write(clientId, 2, CLIENT_ID_LENGTH, 'utf-8');
  return buf;
}

/**
 * 构建 TCP 数据帧
 *
 * @param connectionId - 连接 ID（36 字节 UUID 字符串）
 * @param data - 要发送的原始数据
 * @returns 数据帧 Buffer：[4B 帧长度 BE][36B connectionId][NB data]
 */
export function writeDataFrame(connectionId: string, data: Buffer): Buffer {
  const payloadLength = CONNECTION_ID_LENGTH + data.length;
  const buf = Buffer.alloc(FRAME_LENGTH_SIZE + payloadLength);
  buf.writeUInt32BE(payloadLength, 0);
  getConnectionIdBuffer(connectionId).copy(buf, FRAME_LENGTH_SIZE);
  data.copy(buf, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
  return buf;
}

/**
 * TCP 数据帧解析器
 *
 * 从 TCP 流中解析二进制数据帧，处理 TCP 粘包/拆包问题。
 * 当解析出完整帧时触发 `'frame'` 事件。
 *
 * @example
 * ```typescript
 * const parser = new FrameParser();
 * parser.on('frame', (connectionId, data) => { ... });
 * socket.on('data', (chunk) => parser.push(chunk));
 * ```
 */
export class FrameParser extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * 向解析器推入数据块
   *
   * @param chunk - 从 TCP 流接收到的数据块
   */
  push(chunk: Buffer): void {
    if (this.buffer.length === 0) {
      this.buffer = chunk;
    } else {
      this.buffer = Buffer.concat([this.buffer, chunk]);
    }
    this.parse();
  }

  private parse(): void {
    while (true) {
      // 至少需要 4 字节读取帧长度
      if (this.buffer.length < FRAME_LENGTH_SIZE) break;

      const payloadLength = this.buffer.readUInt32BE(0);

      // 等待完整帧
      const totalLength = FRAME_LENGTH_SIZE + payloadLength;
      if (this.buffer.length < totalLength) break;

      // 解析 connectionId 和数据
      const connectionId = this.buffer.toString('utf-8', FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
      const data = this.buffer.subarray(FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH, totalLength);

      this.emit('frame', connectionId, Buffer.from(data));

      // 移除已解析的帧
      this.buffer = this.buffer.subarray(totalLength);
    }
  }

  /** 重置解析器状态 */
  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

/**
 * 构建 UDP 注册帧
 *
 * @param clientId - 客户端 ID
 * @returns 注册帧 Buffer：[0xFD][0x02][36B clientId]
 */
export function writeUdpRegisterFrame(clientId: string): Buffer {
  const buf = Buffer.alloc(2 + CLIENT_ID_LENGTH);
  DATA_CHANNEL_MAGIC.UDP_REGISTER.copy(buf, 0);
  buf.write(clientId, 2, CLIENT_ID_LENGTH, 'utf-8');
  return buf;
}

/**
 * 构建 UDP 保活帧
 *
 * @param clientId - 客户端 ID
 * @returns 保活帧 Buffer：[0xFD][0x03][36B clientId]
 */
export function writeUdpKeepaliveFrame(clientId: string): Buffer {
  const buf = Buffer.alloc(2 + CLIENT_ID_LENGTH);
  DATA_CHANNEL_MAGIC.UDP_KEEPALIVE.copy(buf, 0);
  buf.write(clientId, 2, CLIENT_ID_LENGTH, 'utf-8');
  return buf;
}

/**
 * 构建 UDP 数据帧
 *
 * @param connectionId - 连接 ID
 * @param data - 要发送的原始数据
 * @returns 数据帧 Buffer：[36B connectionId][NB data]
 */
export function writeUdpDataFrame(connectionId: string, data: Buffer): Buffer {
  const buf = Buffer.alloc(CONNECTION_ID_LENGTH + data.length);
  getConnectionIdBuffer(connectionId).copy(buf, 0);
  data.copy(buf, CONNECTION_ID_LENGTH);
  return buf;
}

/**
 * 解析 UDP 数据帧
 *
 * @param buffer - 收到的 UDP 数据包
 * @returns 解析后的 connectionId 和数据，或 null（如果是控制帧或格式无效）
 */
export function parseUdpDataFrame(buffer: Buffer): { connectionId: string; data: Buffer } | null {
  if (buffer.length < CONNECTION_ID_LENGTH) return null;

  // 检查是否为控制帧（魔数开头）
  if (buffer[0] === 0xFD && buffer.length >= 2) {
    return null; // 控制帧，不是数据帧
  }

  const connectionId = buffer.toString('utf-8', 0, CONNECTION_ID_LENGTH);
  const data = buffer.subarray(CONNECTION_ID_LENGTH);
  return { connectionId, data };
}

/**
 * 解析 UDP 控制帧（注册/保活）
 *
 * @param buffer - 收到的 UDP 数据包
 * @returns 解析结果：类型和 clientId，或 null
 */
export function parseUdpControlFrame(buffer: Buffer): { type: 'register' | 'keepalive'; clientId: string } | null {
  if (buffer.length < 2 + CLIENT_ID_LENGTH) return null;
  if (buffer[0] !== 0xFD) return null;

  const clientId = buffer.toString('utf-8', 2, 2 + CLIENT_ID_LENGTH);

  if (buffer[1] === 0x02) {
    return { type: 'register', clientId };
  }
  if (buffer[1] === 0x03) {
    return { type: 'keepalive', clientId };
  }

  return null;
}

/**
 * 检测 TCP 连接是否为数据通道认证
 *
 * 检查数据的前两个字节是否为 TCP 数据通道魔数。
 *
 * @param data - TCP 连接的初始数据
 * @returns 是否为数据通道连接
 */
export function isDataChannelAuth(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0xFD && data[1] === 0x01;
}

/**
 * 解析 TCP 数据通道认证帧
 *
 * @param data - 初始数据（至少 38 字节：2B 魔数 + 36B clientId）
 * @returns clientId，或 null
 */
export function parseTcpAuthFrame(data: Buffer): string | null {
  if (data.length < 2 + CLIENT_ID_LENGTH) return null;
  if (!isDataChannelAuth(data)) return null;
  return data.toString('utf-8', 2, 2 + CLIENT_ID_LENGTH);
}
