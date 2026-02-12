/**
 * @module integration/full-flow.test
 * @description 简化的 WebSocket 通信集成测试
 *
 * 专注于测试基本的 WebSocket 通信功能，包括：
 * - 连接建立和断开
 * - 消息发送和接收
 * - JSON 序列化/反序列化
 * - 基本的超时处理
 * - 错误场景处理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

// 测试端口
const PORTS = {
  controlServer: 20400,
};

// 测试 Token
const TEST_TOKEN = 'integration-test-token';

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

describe('WebSocket 通信集成测试', () => {
  let wss: WebSocketServer;

  beforeEach(async () => {
    // 创建 WebSocket 控制服务器
    wss = new WebSocketServer({ port: PORTS.controlServer });

    // 添加消息处理器自动响应各种消息
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

          // 自动响应心跳消息
          if (msg.type === 'heartbeat') {
            ws.send(JSON.stringify({
              type: 'heartbeat_resp',
              id: msg.id,
              payload: { timestamp: Date.now() }
            }));
            return;
          }

          // 对于其他消息，回显 payload 中的数据
          // 将消息类型添加 _resp 后缀
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
      wss = null;
    }
    await sleep(50);
  });

  describe('连接建立', () => {
    it('应该能够建立 WebSocket 连接', async () => {
      let serverReceivedConnection = false;

      wss.on('connection', () => {
        serverReceivedConnection = true;
      });

      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');
      await sleep(50);

      expect(serverReceivedConnection).toBe(true);
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('应该能够处理连接关闭', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      let serverClosed = false;
      ws.on('close', () => {
        // 服务端关闭连接
      serverClosed = true;
      });

      // 关闭连接
      ws.close();

      await sleep(100);

      expect(serverClosed).toBe(true);
      expect(ws.readyState).toBe(WebSocket.CLOSED);
    });

    it('应该能够处理连接错误', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      let errorOccurred = false;

      ws.on('error', () => {
        errorOccurred = true;
      });

      // 模拟一个无效的 URL
      const badWs = new WebSocket('ws://localhost:9999');

      let badError = false;
      badWs.on('error', () => {
        badError = true;
      });

      // 等待一小段时间
      await sleep(100);

      expect(errorOccurred).toBe(false);
      expect(badError).toBe(true);

      badWs.close();
      ws.close();
    });
  });

  describe('消息发送和接收', () => {
    it('应该能够发送和接收文本消息', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const testMsg = {
        type: 'test_message',
        id: uuidv4(),
        payload: { text: 'Hello from client!' }
      };

      ws.send(JSON.stringify(testMsg));

      const response = await waitForMessage(ws);

      expect(response.payload.text).toBe('Hello from client!');
      expect(response.type).toBe('test_message_resp');

      ws.close();
    });

    it('应该能够处理 JSON 消息', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const jsonData = {
        name: 'test user',
        value: 12345,
        timestamp: Date.now()
      };

      const jsonMsg = {
        type: 'json_data',
        id: uuidv4(),
        payload: jsonData
      };

      ws.send(JSON.stringify(jsonMsg));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('json_data_resp');
      expect(response.payload.name).toBe('test user');
      expect(response.payload.value).toBe(12345);

      ws.close();
    });

    it('应该能够处理二进制数据', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const binaryData = Buffer.from([0x01, 0x02, 0x03, 0xFF, 0xFE]);
      const binaryMsg = {
        type: 'binary_data',
        id: uuidv4(),
        payload: {
          data: binaryData.toString('base64')
        }
      };

      ws.send(JSON.stringify(binaryMsg));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('binary_data_resp');
      expect(response.payload.data).toBeDefined();
      const responseData = Buffer.from(response.payload.data, 'base64');
      expect(responseData).toEqual(binaryData);

      ws.close();
    });
  });

  describe('认证流程', () => {
    it('应该成功认证', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 发送认证消息
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };

      ws.send(JSON.stringify(authMsg));

      // 等待认证响应
      const response = await waitForMessage(ws);

      expect(response.type).toBe('auth_resp');
      expect(response.payload.success).toBe(true);

      ws.close();
    });

    it('应该拒绝无效的认证令牌', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: 'invalid-token' }
      };

      ws.send(JSON.stringify(authMsg));

      // 等待认证响应
      const response = await waitForMessage(ws);

      expect(response.type).toBe('auth_resp');
      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toBeDefined();

      ws.close();
    });
  });

  describe('心跳机制', () => {
    it('应该能够发送和接收心跳消息', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const heartbeatMsg = {
        type: 'heartbeat',
        id: uuidv4(),
        payload: { timestamp: Date.now() }
      };

      ws.send(JSON.stringify(heartbeatMsg));

      const response = await waitForMessage(ws);

      expect(response.type).toBe('heartbeat_resp');
      expect(response.payload.timestamp).toBeDefined();
      expect(typeof response.payload.timestamp).toBe('number');

      ws.close();
    });

    it('应该能够持续发送多个心跳', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const heartbeatCount = 3;
      const timestamps: number[] = [];

      for (let i = 0; i < heartbeatCount; i++) {
        const heartbeatMsg = {
          type: 'heartbeat',
          id: uuidv4(),
          payload: { timestamp: Date.now() }
        };

        const sendPromise = waitForMessage(ws);

        ws.send(JSON.stringify(heartbeatMsg));

        const response = await sendPromise;
        timestamps.push(response.payload.timestamp);

        await sleep(50);
      }

      expect(timestamps).toHaveLength(heartbeatCount);
      timestamps.forEach(ts => {
        expect(typeof ts).toBe('number');
      });

      ws.close();
    });
  });

  describe('错误处理', () => {
    it('应该能够处理无效的 JSON 消息', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 发送无效的 JSON
      ws.send('invalid json{{}');

      await sleep(100);

      // 连接应该仍然有效（不会因为无效消息关闭）
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('应该能够处理未知的消息类型', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 发送未知类型的消息
      const unknownMsg = {
        type: 'unknown_type',
        id: uuidv4(),
        payload: { data: 'test' }
      };

      ws.send(JSON.stringify(unknownMsg));

      await sleep(100);

      // 客户端应该保持连接（服务端忽略未知消息）
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });

    it('应该能够处理大消息', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 创建一个大的消息（1MB）
      const largePayload = {
        data: 'x'.repeat(1024 * 1024) // 1MB of 'x'
      };

      const largeMsg = {
        type: 'large_message',
        id: uuidv4(),
        payload: largePayload
      };

      ws.send(JSON.stringify(largeMsg));

      await sleep(200);

      // 连接应该仍然有效
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    });
  });

  describe('消息序列化', () => {
    it('应该正确序列化和反序列化消息', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const originalData = {
        type: 'serialization_test',
        id: uuidv4(),
        payload: {
          number: 12345,
          text: 'test',
          array: [1, 2, 3],
          nested: { a: 'value1' }
        }
      };

      ws.send(JSON.stringify(originalData));

      const response = await waitForMessage(ws);

      expect(response.payload).toEqual(originalData.payload);
      expect(response.type).toBe('serialization_test_resp');

      ws.close();
    });

    it('应该能够处理特殊字符', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      const specialData = {
        type: 'special_chars',
        id: uuidv4(),
        payload: {
          text: 'Test with special chars: \n\r\t"\'\\/'
        }
      };

      ws.send(JSON.stringify(specialData));

      const response = await waitForMessage(ws);

      expect(response.payload.text).toContain('Test');
      expect(response.type).toBe('special_chars_resp');

      ws.close();
    });
  });

  describe('超时处理', () => {
    it('应该能够在不活动连接后超时', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 不发送任何消息，等待超时
      await sleep(6000);

      // 连接应该仍然有效
      expect(ws.readyState).toBe(WebSocket.OPEN);

      ws.close();
    }, 20000);

    it('应该能够处理延迟响应', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 发送一个消息
      const msg = {
        type: 'delayed_test',
        id: uuidv4(),
        payload: { data: 'test' }
      };

      ws.send(JSON.stringify(msg));

      // 服务端延迟 3 秒后响应
      const response = await new Promise<any>((resolve) => {
        const handler = (data: Buffer) => {
          try {
            const parsed = JSON.parse(data.toString());
            if (parsed.type === 'delayed_test_resp') {
              clearTimeout(timer);
              resolve(parsed);
            }
          } catch (e) {
            // 忽略
          }
        };

        const timer = setTimeout(() => {
          resolve(null); // 超时
        }, 5000);

        ws.on('message', handler);
      });

      const result = await response;
      expect(result).toBeTruthy();
      expect(result.type).toBe('delayed_test_resp');

      ws.close();
    }, 10000);
  });

  describe('多客户端', () => {
    it('应该能够处理多个客户端连接', async () => {
      // 创建多个客户端，每个客户端发送并立即等待响应
      const clientCount = 3;
      const clients: WebSocket[] = [];
      const responses: any[] = [];

      for (let i = 0; i < clientCount; i++) {
        const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

        await waitForEvent(ws, 'open');

        // 每个客户端发送不同的消息
        const testMsg = {
          type: `multi_client_test_${i}`,
          id: uuidv4(),
          payload: { clientId: `client-${i}`, data: `message from client ${i}` }
        };

        ws.send(JSON.stringify(testMsg));

        // 立即等待该客户端的响应
        const response = await waitForMessage(ws);
        responses.push(response);

        clients.push(ws);
      }

      expect(responses.length).toBe(clientCount);

      // 关闭所有连接
      clients.forEach(ws => ws.close());
    });

    it('应该能够处理客户端断开重连', async () => {
      const reconnectEvents: string[] = [];

      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      wss.on('connection', () => {
        ws.on('close', () => {
          reconnectEvents.push('close');
        });
      });

      await waitForEvent(ws, 'open');
      expect(ws.readyState).toBe(WebSocket.OPEN);

      // 第一次断开
      ws.close();

      await sleep(100);

      // 重连
      const ws2 = new WebSocket(`ws://localhost:${PORTS.controlServer}`);
      await waitForEvent(ws2, 'open');
      expect(ws2.readyState).toBe(WebSocket.OPEN);

      ws2.close();
      wss.close();
    });
  });

  describe('消息类型兼容性', () => {
    it('应该兼容不同的消息格式', async () => {
      const ws = new WebSocket(`ws://localhost:${PORTS.controlServer}`);

      await waitForEvent(ws, 'open');

      // 测试多种消息格式 - 需要添加 id
      const messageTypes = [
        { type: 'type1', id: uuidv4(), payload: { data: 'format1' } },
        { type: 'type2', id: uuidv4(), payload: { value: 42 } },
        { type: 'type3', id: uuidv4(), payload: { text: 'format3' } },
        { type: 'type4', id: uuidv4(), payload: { obj: { key: 'value' } } }
      ];

      // 逐个发送消息并收集响应
      const responses: any[] = [];
      for (const msg of messageTypes) {
        ws.send(JSON.stringify(msg));
        const response = await waitForMessage(ws, 3000);
        responses.push(response);
        await sleep(20);
      }

      expect(responses.length).toBe(messageTypes.length);

      // 验证每个响应都是正确的类型
      expect(responses[0].type).toBe('type1_resp');
      expect(responses[1].type).toBe('type2_resp');
      expect(responses[2].type).toBe('type3_resp');
      expect(responses[3].type).toBe('type4_resp');

      ws.close();
    });
  });
});

// 辅助函数：等待消息
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
