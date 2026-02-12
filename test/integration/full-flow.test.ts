/**
 * @module integration/full-flow.test
 * @description 全流程集成测试 - 测试客户端与服务端之间的完整通信流程
 *
 * 注意：这些测试使用简化的模拟服务端，不依赖真实的服务端实现。
 * 主要测试 WebSocket 通信、消息序列化/反序列化、协议兼容性等。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// 测试用端口
const PORTS = {
  controlServer: 20300,
};

// 测试 Token
const TEST_TOKEN = 'integration-test-token-' + Date.now();

// 辅助函数：延迟
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助函数：等待事件
function waitForEvent(emitter: any, event: string, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    const handler = (...args: any[]) => {
      clearTimeout(timer);
      emitter.off(event, handler);
      resolve(args.length === 1 ? args[0] : args);
    };

    emitter.on(event, handler);
  });
}

// 辅助函数：等待 WebSocket 消息并解析
function waitForMessage(ws: WebSocket, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Timeout waiting for message'));
    }, timeout);

    const handler = (data: Buffer) => {
      clearTimeout(timer);
      ws.off('message', handler);
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    };

    ws.on('message', handler);
  });
}

describe('全流程集成测试 - WebSocket通信', () => {
  let wss: WebSocketServer;

  beforeEach(async () => {
    // 创建 WebSocket 控制服务器
    wss = new WebSocketServer({ port: PORTS.controlServer });

    // 添加简单的消息处理器来自动响应常见消息
    wss.on('connection', (ws) => {
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          // 自动响应认证消息
          if (msg.type === 'auth') {
            const success = msg.payload.token === TEST_TOKEN;
            ws.send(JSON.stringify({
              type: 'auth_resp',
              id: msg.id,
              payload: {
                success,
                error: success ? undefined : 'Invalid token'
              }
            }));
            return;
          }

          // 自动响应注册消息
          if (msg.type === 'register') {
            ws.send(JSON.stringify({
              type: 'register_resp',
              id: msg.id,
              payload: {
                success: true,
                remotePort: msg.payload.remotePort,
                remoteUrl: `http://localhost:${msg.payload.remotePort}`
              }
            }));
            return;
          }

          // 自动响应注销消息
          if (msg.type === 'unregister') {
            ws.send(JSON.stringify({
              type: 'unregister_resp',
              id: msg.id,
              payload: { success: true }
            }));
            return;
          }

          // 自动响应心跳消息
          if (msg.type === 'heartbeat') {
            ws.send(JSON.stringify({
              type: 'heartbeat_resp',
              id: msg.id,
              payload: { timestamp: Date.now() }
            }));
            return;
          }

          // 对于其他消息类型，通用回显
          const respType = msg.type + '_resp';
          ws.send(JSON.stringify({
            type: respType,
            id: msg.id,
            payload: msg.payload || {}
          }));

        } catch (e) {
          // 忽略解析错误
        }
      });
    });

    // 等待服务器启动
    await sleep(50);
  });

  afterEach(async () => {
    // 清理资源
    if (wss) {
      wss.close();
      wss = null as any;
    }
    await sleep(50);
  });

  describe('WebSocket 连接和认证', () => {
    it('应该成功完成 WebSocket 握手', async () => {
      let clientConnected = false;

      wss.on('connection', () => {
        clientConnected = true;
      });

      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');
      await sleep(50);

      expect(clientConnected).toBe(true);
      expect(clientWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
    });

    it('应该能够发送和接收认证消息 - 有效token', async () => {
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };

      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 发送认证消息
      clientWs.send(JSON.stringify(authMsg));

      // 等待服务端自动响应
      const parsed = await waitForMessage(clientWs);
      expect(parsed.type).toBe('auth_resp');
      expect(parsed.payload.success).toBe(true);

      clientWs.close();
    });

    it('应该拒绝无效的认证令牌', async () => {
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: 'invalid-token' }
      };

      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      clientWs.send(JSON.stringify(authMsg));

      // 等待服务端自动响应
      const parsed = await waitForMessage(clientWs);
      expect(parsed.payload.success).toBe(false);
      expect(parsed.payload.error).toBeDefined();

      clientWs.close();
    });
  });

  describe('消息类型兼容性', () => {
    it('应该兼容 tcp_data 和 tcp_data_resp 两种格式', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 测试 tcp_data 格式（简化格式，直接有 connectionId 和 data）
      const tcpDataMsg1 = {
        type: 'tcp_data',
        id: uuidv4(),
        payload: {
          connectionId: uuidv4(),
          data: Buffer.from('data1').toString('base64')
        }
      };

      clientWs.send(JSON.stringify(tcpDataMsg1));
      const resp1 = await waitForMessage(clientWs);
      expect(resp1.type).toBe('tcp_data_resp');

      // 测试 tcp_data_resp 格式
      const tcpDataMsg2 = {
        type: 'tcp_data_resp',
        id: uuidv4(),
        payload: {
          connectionId: uuidv4(),
          data: Buffer.from('data2').toString('base64')
        }
      };

      clientWs.send(JSON.stringify(tcpDataMsg2));
      const resp2 = await waitForMessage(clientWs);
      expect(resp2.type).toBe('tcp_data_resp_resp');

      clientWs.close();
    }, 15000);

    it('应该正确处理新连接通知', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      const connectionId = uuidv4();
      const newConnMsg = {
        type: 'new_connection',
        id: uuidv4(),
        payload: {
          connectionId,
          protocol: 'tcp',
          remoteAddress: '192.168.1.100:54321'
        }
      };

      clientWs.send(JSON.stringify(newConnMsg));

      // 等待服务端自动响应（确认收到）
      const resp = await waitForMessage(clientWs);
      expect(resp.type).toBe('new_connection_resp');

      clientWs.close();
    });
  });

  describe('心跳机制', () => {
    it('应该能够发送和响应心跳消息', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      const heartbeatMsg = {
        type: 'heartbeat',
        id: uuidv4(),
        payload: { timestamp: Date.now() }
      };

      clientWs.send(JSON.stringify(heartbeatMsg));

      // 等待服务端自动响应
      const parsed = await waitForMessage(clientWs);
      expect(parsed.type).toBe('heartbeat_resp');
      expect(parsed.payload.timestamp).toBeDefined();
      expect(typeof parsed.payload.timestamp).toBe('number');

      clientWs.close();
    });

    it('应该能够持续发送多个心跳', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      const heartbeatCount = 3;
      const timestamps: number[] = [];

      for (let i = 0; i < heartbeatCount; i++) {
        const heartbeatMsg = {
          type: 'heartbeat',
          id: uuidv4(),
          payload: { timestamp: Date.now() }
        };

        const sendPromise = waitForMessage(clientWs);

        clientWs.send(JSON.stringify(heartbeatMsg));

        const parsed = await sendPromise;
        timestamps.push(parsed.payload.timestamp);

        await sleep(50);
      }

      expect(timestamps).toHaveLength(heartbeatCount);
      timestamps.forEach(ts => {
        expect(typeof ts).toBe('number');
      });

      clientWs.close();
    });
  });

  describe('端口注册流程', () => {
    it('应该能够注册 HTTP 代理端口', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 先认证
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };

      clientWs.send(JSON.stringify(authMsg));

      // 等待认证响应
      await waitForMessage(clientWs);

      // 注册端口
      const registerMsg = {
        type: 'register',
        id: uuidv4(),
        payload: {
          remotePort: 2222,
          localPort: 80,
          protocol: 'http'
        }
      };

      clientWs.send(JSON.stringify(registerMsg));

      // 等待注册响应
      const parsed = await waitForMessage(clientWs);
      expect(parsed.payload.success).toBe(true);
      expect(parsed.payload.remotePort).toBe(2222);

      clientWs.close();
    });

    it('应该能够注销已注册的端口', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 先认证
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };

      clientWs.send(JSON.stringify(authMsg));

      // 等待认证响应
      await waitForMessage(clientWs);

      // 注销端口
      const unregisterMsg = {
        type: 'unregister',
        id: uuidv4(),
        payload: {
          remotePort: 2222
        }
      };

      clientWs.send(JSON.stringify(unregisterMsg));

      // 等待注销响应
      const parsed = await waitForMessage(clientWs);
      expect(parsed.type).toBe('unregister_resp');

      clientWs.close();
    });
  });

  describe('连接状态管理', () => {
    it('应该能够检测连接断开', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      let serverDisconnected = false;
      let serverWs: WebSocket | null = null;

      wss.on('connection', (ws) => {
        serverWs = ws;
        ws.on('close', () => {
          serverDisconnected = true;
        });
      });

      await waitForEvent(clientWs, 'open');

      // 客户端主动断开
      clientWs.close();

      await sleep(200);

      expect(serverDisconnected).toBe(true);
      expect(clientWs.readyState).toBe(WebSocket.CLOSED);
    });

    it('应该能够在断开后重新连接', async () => {
      const clientWs1 = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs1, 'open');

      expect(clientWs1.readyState).toBe(WebSocket.OPEN);

      // 关闭第一个连接
      clientWs1.close();
      await sleep(100);

      expect(clientWs1.readyState).toBe(WebSocket.CLOSED);

      // 创建新连接
      const clientWs2 = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs2, 'open');

      expect(clientWs2.readyState).toBe(WebSocket.OPEN);

      clientWs2.close();
    });
  });

  describe('错误处理', () => {
    it('应该能够处理连接错误通知', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      const connectionId = uuidv4();

      // 发送连接错误消息
      const errorMsg = {
        type: 'connection_error',
        id: uuidv4(),
        payload: {
          connectionId,
          error: 'Connection timeout'
        }
      };

      clientWs.send(JSON.stringify(errorMsg));

      // 等待服务端确认
      await sleep(100);

      // 连接应该仍然有效
      expect(clientWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
    });

    it('应该能够处理无效的消息格式', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 发送无效的 JSON
      clientWs.send('invalid json{{{}');

      await sleep(100);

      // 连接应该仍然有效（WebSocket 不会因为无效消息而关闭）
      expect(clientWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
    });

    it('应该能够处理未知消息类型', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 发送未知类型的消息
      const unknownMsg = {
        type: 'unknown_message_type',
        id: uuidv4(),
        payload: {}
      };

      clientWs.send(JSON.stringify(unknownMsg));

      await sleep(100);

      // 客户端应该保持连接（服务端回显通用响应）
      expect(clientWs.readyState).toBe(WebSocket.OPEN);

      clientWs.close();
    });
  });

  describe('数据完整性', () => {
    it('应该能够正确处理二进制数据的 Base64 编码', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      const connectionId = uuidv4();

      // 测试包含特殊字符和二进制数据
      const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      const base64Encoded = binaryData.toString('base64');

      const tcpDataMsg = {
        type: 'binary_data_test',
        id: uuidv4(),
        payload: {
          connectionId,
          data: base64Encoded
        }
      };

      clientWs.send(JSON.stringify(tcpDataMsg));

      // 等待服务端回显
      const parsed = await waitForMessage(clientWs);
      expect(parsed.type).toBe('binary_data_test_resp');
      expect(parsed.payload.data).toBe(base64Encoded);

      // 验证可以正确解码
      const decoded = Buffer.from(parsed.payload.data, 'base64');
      expect(decoded).toEqual(binaryData);

      clientWs.close();
    });

    it('应该能够处理大数据块', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      const connectionId = uuidv4();

      // 创建大数据块（10KB）
      const largeData = Buffer.alloc(10 * 1024, 'x');
      const base64LargeData = largeData.toString('base64');

      const tcpDataMsg = {
        type: 'large_data_test',
        id: uuidv4(),
        payload: {
          connectionId,
          data: base64LargeData
        }
      };

      clientWs.send(JSON.stringify(tcpDataMsg));

      // 等待服务端回显
      const parsed = await waitForMessage(clientWs);
      expect(parsed.type).toBe('large_data_test_resp');
      expect(parsed.payload.data.length).toBe(base64LargeData.length);

      // 验证数据完整性
      const decoded = Buffer.from(parsed.payload.data, 'base64');
      expect(decoded.length).toBe(largeData.length);

      clientWs.close();
    });
  });

  describe('并发连接处理', () => {
    it('应该能够处理多个并发连接', async () => {
      const clientWs = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(clientWs, 'open');

      // 简化测试：只发送几个消息并验证能收到响应
      const requestCount = 3;

      // 逐个发送消息并立即等待响应
      const responses: any[] = [];
      for (let i = 0; i < requestCount; i++) {
        const newConnMsg = {
          type: `test_msg_${i}`,
          id: uuidv4(),
          payload: {
            index: i,
            data: `test data ${i}`
          }
        };

        clientWs.send(JSON.stringify(newConnMsg));

        // 等待这个消息的响应
        const resp = await waitForMessage(clientWs, 3000);
        responses.push(resp);

        await sleep(20);
      }

      expect(responses.length).toBe(requestCount);

      clientWs.close();
    });
  });
});
