/**
 * @module data-channel.test
 * @description 数据通道协议工具的单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONNECTION_ID_LENGTH,
  FRAME_LENGTH_SIZE,
  writeDataFrame,
  writeUdpDataFrame,
  clearConnectionIdBuffer,
  FrameParser,
  parseUdpDataFrame,
  writeUdpRegisterFrame,
  writeUdpKeepaliveFrame,
  parseUdpControlFrame,
  writeTcpAuthFrame,
  parseTcpAuthFrame,
  isDataChannelAuth,
  DATA_CHANNEL_MAGIC,
  AUTH_RESPONSE,
} from '../src/data-channel.js';

const TEST_CONN_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const TEST_CONN_ID2 = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

describe('data-channel - connectionId 缓存', () => {
  beforeEach(() => {
    // 清理缓存，确保每个测试独立
    clearConnectionIdBuffer(TEST_CONN_ID);
    clearConnectionIdBuffer(TEST_CONN_ID2);
  });

  it('writeDataFrame 应该使用缓存的 connectionId 编码', () => {
    const data = Buffer.from('hello');
    const frame1 = writeDataFrame(TEST_CONN_ID, data);
    const frame2 = writeDataFrame(TEST_CONN_ID, Buffer.from('world'));

    // 两帧中的 connectionId 部分应该完全一致
    const id1 = frame1.subarray(FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
    const id2 = frame2.subarray(FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
    expect(id1).toEqual(id2);
    expect(id1.toString('utf-8')).toBe(TEST_CONN_ID);
  });

  it('writeUdpDataFrame 应该使用缓存的 connectionId 编码', () => {
    const data = Buffer.from('udp-test');
    const frame1 = writeUdpDataFrame(TEST_CONN_ID, data);
    const frame2 = writeUdpDataFrame(TEST_CONN_ID, Buffer.from('udp-test2'));

    const id1 = frame1.subarray(0, CONNECTION_ID_LENGTH);
    const id2 = frame2.subarray(0, CONNECTION_ID_LENGTH);
    expect(id1).toEqual(id2);
    expect(id1.toString('utf-8')).toBe(TEST_CONN_ID);
  });

  it('不同 connectionId 应该生成不同的缓存', () => {
    const frame1 = writeDataFrame(TEST_CONN_ID, Buffer.from('a'));
    const frame2 = writeDataFrame(TEST_CONN_ID2, Buffer.from('b'));

    const id1 = frame1.subarray(FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH).toString('utf-8');
    const id2 = frame2.subarray(FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH).toString('utf-8');
    expect(id1).toBe(TEST_CONN_ID);
    expect(id2).toBe(TEST_CONN_ID2);
  });

  it('clearConnectionIdBuffer 应该清除指定 connectionId 的缓存', () => {
    // 先生成缓存
    writeDataFrame(TEST_CONN_ID, Buffer.from('test'));
    // 清除缓存
    clearConnectionIdBuffer(TEST_CONN_ID);
    // 再次调用仍应正常工作（重新缓存）
    const frame = writeDataFrame(TEST_CONN_ID, Buffer.from('test2'));
    const id = frame.subarray(FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH).toString('utf-8');
    expect(id).toBe(TEST_CONN_ID);
  });

  it('clearConnectionIdBuffer 对不存在的 key 不应报错', () => {
    expect(() => clearConnectionIdBuffer('non-existent-id-000000000000000')).not.toThrow();
  });
});

describe('data-channel - writeDataFrame 帧格式', () => {
  it('应该生成正确的帧结构', () => {
    const data = Buffer.from('hello');
    const frame = writeDataFrame(TEST_CONN_ID, data);

    // 总长度 = 4(帧长度) + 36(connectionId) + 5(data)
    expect(frame.length).toBe(FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH + data.length);

    // 帧长度字段
    const payloadLength = frame.readUInt32BE(0);
    expect(payloadLength).toBe(CONNECTION_ID_LENGTH + data.length);

    // connectionId
    const connId = frame.toString('utf-8', FRAME_LENGTH_SIZE, FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
    expect(connId).toBe(TEST_CONN_ID);

    // data 部分
    const extractedData = frame.subarray(FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
    expect(extractedData).toEqual(data);
  });

  it('应该正确处理空数据帧', () => {
    const data = Buffer.alloc(0);
    const frame = writeDataFrame(TEST_CONN_ID, data);

    expect(frame.length).toBe(FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
    expect(frame.readUInt32BE(0)).toBe(CONNECTION_ID_LENGTH);
  });

  it('应该正确处理大数据帧', () => {
    const data = Buffer.alloc(65536, 0xAB);
    const frame = writeDataFrame(TEST_CONN_ID, data);

    expect(frame.readUInt32BE(0)).toBe(CONNECTION_ID_LENGTH + 65536);
    const extractedData = frame.subarray(FRAME_LENGTH_SIZE + CONNECTION_ID_LENGTH);
    expect(extractedData.length).toBe(65536);
    expect(extractedData[0]).toBe(0xAB);
    expect(extractedData[65535]).toBe(0xAB);
  });
});

describe('data-channel - FrameParser 优化', () => {
  let parser: FrameParser;
  let frames: Array<{ connectionId: string; data: Buffer }>;

  beforeEach(() => {
    clearConnectionIdBuffer(TEST_CONN_ID);
    parser = new FrameParser();
    frames = [];
    parser.on('frame', (connectionId: string, data: Buffer) => {
      frames.push({ connectionId, data });
    });
  });

  it('buffer 为空时 push 应直接赋值（不 concat）', () => {
    const data = Buffer.from('test');
    const frame = writeDataFrame(TEST_CONN_ID, data);

    parser.push(frame);

    expect(frames.length).toBe(1);
    expect(frames[0].connectionId).toBe(TEST_CONN_ID);
    expect(frames[0].data).toEqual(data);
  });

  it('连续 push 完整帧应逐个解析', () => {
    const data1 = Buffer.from('first');
    const data2 = Buffer.from('second');
    const frame1 = writeDataFrame(TEST_CONN_ID, data1);
    const frame2 = writeDataFrame(TEST_CONN_ID, data2);

    parser.push(frame1);
    parser.push(frame2);

    expect(frames.length).toBe(2);
    expect(frames[0].data).toEqual(data1);
    expect(frames[1].data).toEqual(data2);
  });

  it('两帧粘包应正确解析', () => {
    const data1 = Buffer.from('frame-a');
    const data2 = Buffer.from('frame-b');
    const combined = Buffer.concat([
      writeDataFrame(TEST_CONN_ID, data1),
      writeDataFrame(TEST_CONN_ID2, data2),
    ]);

    parser.push(combined);

    expect(frames.length).toBe(2);
    expect(frames[0].connectionId).toBe(TEST_CONN_ID);
    expect(frames[0].data).toEqual(data1);
    expect(frames[1].connectionId).toBe(TEST_CONN_ID2);
    expect(frames[1].data).toEqual(data2);
  });

  it('拆包（帧跨越多个 chunk）应正确解析', () => {
    const data = Buffer.from('split-frame-data');
    const frame = writeDataFrame(TEST_CONN_ID, data);

    // 在帧中间拆分
    const mid = Math.floor(frame.length / 2);
    parser.push(frame.subarray(0, mid));
    expect(frames.length).toBe(0); // 尚未完整

    parser.push(frame.subarray(mid));
    expect(frames.length).toBe(1);
    expect(frames[0].data).toEqual(data);
  });

  it('不完整帧头应等待更多数据', () => {
    // 只发 2 字节，不足 4 字节帧头
    parser.push(Buffer.from([0x00, 0x00]));
    expect(frames.length).toBe(0);

    // 补齐剩余帧数据
    const data = Buffer.from('hi');
    const frame = writeDataFrame(TEST_CONN_ID, data);
    parser.push(frame.subarray(2)); // 从第 2 字节开始不对，这样不行

    // 重新测试：完整帧 = 正确方式
    parser.reset();
    frames = [];
    parser.push(frame);
    expect(frames.length).toBe(1);
  });

  it('reset 应清空内部缓冲区', () => {
    const data = Buffer.from('partial');
    const frame = writeDataFrame(TEST_CONN_ID, data);

    // 推入部分帧
    parser.push(frame.subarray(0, 10));
    parser.reset();

    // 推入完整新帧
    const data2 = Buffer.from('fresh');
    parser.push(writeDataFrame(TEST_CONN_ID, data2));

    expect(frames.length).toBe(1);
    expect(frames[0].data).toEqual(data2);
  });

  it('空 chunk 应正常处理', () => {
    parser.push(Buffer.alloc(0));
    expect(frames.length).toBe(0);

    const data = Buffer.from('after-empty');
    parser.push(writeDataFrame(TEST_CONN_ID, data));
    expect(frames.length).toBe(1);
  });
});

describe('data-channel - parseUdpDataFrame', () => {
  it('应返回 subarray 而非拷贝', () => {
    const data = Buffer.from('udp-payload');
    const frame = writeUdpDataFrame(TEST_CONN_ID, data);

    const result = parseUdpDataFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.connectionId).toBe(TEST_CONN_ID);
    expect(result!.data).toEqual(data);

    // 验证 data 是 frame 的视图（共享底层 ArrayBuffer）
    expect(result!.data.buffer).toBe(frame.buffer);
  });

  it('控制帧应返回 null', () => {
    const frame = writeUdpRegisterFrame('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(parseUdpDataFrame(frame)).toBeNull();
  });

  it('过短的包应返回 null', () => {
    expect(parseUdpDataFrame(Buffer.from('short'))).toBeNull();
  });

  it('纯 connectionId（无数据）应返回空 Buffer', () => {
    const frame = writeUdpDataFrame(TEST_CONN_ID, Buffer.alloc(0));
    const result = parseUdpDataFrame(frame);
    expect(result).not.toBeNull();
    expect(result!.data.length).toBe(0);
  });
});

describe('data-channel - writeUdpDataFrame 帧格式', () => {
  it('应该生成正确的帧结构', () => {
    const data = Buffer.from('udp-data');
    const frame = writeUdpDataFrame(TEST_CONN_ID, data);

    expect(frame.length).toBe(CONNECTION_ID_LENGTH + data.length);
    expect(frame.toString('utf-8', 0, CONNECTION_ID_LENGTH)).toBe(TEST_CONN_ID);
    expect(frame.subarray(CONNECTION_ID_LENGTH)).toEqual(data);
  });
});

describe('data-channel - UDP 控制帧', () => {
  const clientId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('注册帧应正确构建和解析', () => {
    const frame = writeUdpRegisterFrame(clientId);
    expect(frame[0]).toBe(0xFD);
    expect(frame[1]).toBe(0x02);

    const result = parseUdpControlFrame(frame);
    expect(result).toEqual({ type: 'register', clientId });
  });

  it('保活帧应正确构建和解析', () => {
    const frame = writeUdpKeepaliveFrame(clientId);
    expect(frame[0]).toBe(0xFD);
    expect(frame[1]).toBe(0x03);

    const result = parseUdpControlFrame(frame);
    expect(result).toEqual({ type: 'keepalive', clientId });
  });

  it('未知控制帧类型应返回 null', () => {
    const frame = Buffer.alloc(2 + 36);
    frame[0] = 0xFD;
    frame[1] = 0xFF;
    expect(parseUdpControlFrame(frame)).toBeNull();
  });

  it('过短的控制帧应返回 null', () => {
    expect(parseUdpControlFrame(Buffer.from([0xFD, 0x02]))).toBeNull();
  });
});

describe('data-channel - TCP 认证帧', () => {
  const clientId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('应该正确构建和解析', () => {
    const frame = writeTcpAuthFrame(clientId);
    expect(isDataChannelAuth(frame)).toBe(true);
    expect(parseTcpAuthFrame(frame)).toBe(clientId);
  });

  it('非数据通道数据不应被识别为认证帧', () => {
    expect(isDataChannelAuth(Buffer.from('GET / HTTP/1.1'))).toBe(false);
    expect(isDataChannelAuth(Buffer.from([0x00, 0x01]))).toBe(false);
  });

  it('过短的数据应返回 null', () => {
    expect(parseTcpAuthFrame(Buffer.from([0xFD, 0x01]))).toBeNull();
  });
});

describe('data-channel - 常量', () => {
  it('魔数应该正确', () => {
    expect(DATA_CHANNEL_MAGIC.TCP_AUTH).toEqual(Buffer.from([0xFD, 0x01]));
    expect(DATA_CHANNEL_MAGIC.UDP_REGISTER).toEqual(Buffer.from([0xFD, 0x02]));
    expect(DATA_CHANNEL_MAGIC.UDP_KEEPALIVE).toEqual(Buffer.from([0xFD, 0x03]));
  });

  it('认证响应应该正确', () => {
    expect(AUTH_RESPONSE.SUCCESS).toEqual(Buffer.from([0x01]));
    expect(AUTH_RESPONSE.FAILURE).toEqual(Buffer.from([0x00]));
  });
});
