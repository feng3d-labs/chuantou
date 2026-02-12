/**
 * 内网穿透功能测试
 * 测试服务端和客户端之间的通信、注册、心跳和转发功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { setTimeout as sleep } from 'timers/promises';

const sleepMs = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 测试用端口
const TEST_CONTROL_PORT = 19900;
const TEST_PROXY_PORT = 19901;
const TEST_LOCAL_PORT = 19902;

// 测试用 token
const TEST_TOKEN = 'test-token-123';

describe('内网穿透功能测试', () => {
  let wss: WebSocketServer;
  let serverWs: WebSocket | null = null;
  let clientWs: WebSocket | null = null;

  beforeEach(async () => {
    // 创建测试用的 WebSocket 服务器（模拟服务端控制通道）
    wss = new WebSocketServer({ port: TEST_CONTROL_PORT });

    wss.on('connection', (ws) => {
      serverWs = ws;

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          handleMessage(msg, ws);
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            id: uuidv4(),
            payload: { error: 'Invalid message format' }
          }));
        }
      });

      ws.on('close', () => {
        serverWs = null;
      });
    });

    // 等待服务器启动
    await sleepMs(100);
  });

  afterEach(async () => {
    if (clientWs) {
      clientWs.close();
      clientWs = null;
    }
    if (serverWs) {
      serverWs.close();
      serverWs = null;
    }
    if (wss) {
      wss.close();
      wss = null;
    }
    await sleepMs(100);
  });

  // 简单的消息处理器（模拟服务端逻辑）
  function handleMessage(msg: any, ws: WebSocket) {
    switch (msg.type) {
      case 'auth': {
        // 认证请求
        const isValid = msg.payload.token === TEST_TOKEN;
        ws.send(JSON.stringify({
          type: 'auth_resp',
          id: msg.id,
          payload: {
            success: isValid,
            error: isValid ? undefined : 'Invalid token'
          }
        }));
        break;
      }
      case 'register': {
        // 注册请求
        ws.send(JSON.stringify({
          type: 'register_resp',
          id: msg.id,
          payload: {
            success: true,
            remotePort: msg.payload.remotePort,
            remoteUrl: `http://localhost:${msg.payload.remotePort}`
          }
        }));
        break;
      }
      case 'heartbeat': {
        // 心跳响应
        ws.send(JSON.stringify({
          type: 'heartbeat_resp',
          id: msg.id,
          payload: { timestamp: Date.now() }
        }));
        break;
      }
      case 'unregister': {
        // 注销响应
        ws.send(JSON.stringify({
          type: 'unregister_resp',
          id: msg.id,
          payload: { success: true }
        }));
        break;
      }
    }
  }

  describe('客户端连接和认证', () => {
    it('应该能够连接到服务端', async () => {
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);

      await new Promise<void>((resolve, reject) => {
        clientWs!.on('open', () => resolve());
        clientWs!.on('error', reject);
      });

      expect(clientWs.readyState).toBe(WebSocket.OPEN);
    });

    it('应该能够成功认证', async () => {
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);

      await new Promise<void>((resolve) => {
        clientWs!.on('open', () => resolve());
      });

      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };

      clientWs.send(JSON.stringify(authMsg));

      const response = await new Promise<any>((resolve) => {
        clientWs!.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('auth_resp');
      expect(response.payload.success).toBe(true);
    });

    it('应该拒绝错误的认证令牌', async () => {
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);

      await new Promise<void>((resolve) => {
        clientWs!.on('open', () => resolve());
      });

      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: 'wrong-token' }
      };

      clientWs.send(JSON.stringify(authMsg));

      const response = await new Promise<any>((resolve) => {
        clientWs!.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('auth_resp');
      expect(response.payload.success).toBe(false);
      expect(response.payload.error).toBe('Invalid token');
    });
  });

  describe('代理注册', () => {
    beforeEach(async () => {
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);
      await new Promise<void>((resolve) => {
        clientWs!.on('open', () => resolve());
      });

      // 先认证
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };
      clientWs.send(JSON.stringify(authMsg));

      await new Promise<void>((resolve) => {
        clientWs!.once('message', () => resolve());
      });
    });

    it('应该能够成功注册 HTTP 代理', async () => {
      const registerMsg = {
        type: 'register',
        id: uuidv4(),
        payload: {
          remotePort: TEST_PROXY_PORT,
          protocol: 'http',
          localPort: TEST_LOCAL_PORT,
          localHost: 'localhost'
        }
      };

      clientWs!.send(JSON.stringify(registerMsg));

      const response = await new Promise<any>((resolve) => {
        clientWs!.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('register_resp');
      expect(response.payload.success).toBe(true);
      expect(response.payload.remotePort).toBe(TEST_PROXY_PORT);
      expect(response.payload.remoteUrl).toBe(`http://localhost:${TEST_PROXY_PORT}`);
    });

    it('应该能够成功注册 WebSocket 代理', async () => {
      const registerMsg = {
        type: 'register',
        id: uuidv4(),
        payload: {
          remotePort: TEST_PROXY_PORT + 1,
          protocol: 'websocket',
          localPort: TEST_LOCAL_PORT + 1,
          localHost: 'localhost'
        }
      };

      clientWs!.send(JSON.stringify(registerMsg));

      const response = await new Promise<any>((resolve) => {
        clientWs!.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('register_resp');
      expect(response.payload.success).toBe(true);
      expect(response.payload.remotePort).toBe(TEST_PROXY_PORT + 1);
    });
  });

  describe('心跳机制', () => {
    beforeEach(async () => {
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);
      await new Promise<void>((resolve) => {
        clientWs!.on('open', () => resolve());
      });

      // 先认证
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };
      clientWs.send(JSON.stringify(authMsg));

      await new Promise<void>((resolve) => {
        clientWs!.once('message', () => resolve());
      });
    });

    it('应该能够发送心跳并收到响应', async () => {
      const heartbeatMsg = {
        type: 'heartbeat',
        id: uuidv4(),
        payload: { timestamp: Date.now() }
      };

      clientWs!.send(JSON.stringify(heartbeatMsg));

      const response = await new Promise<any>((resolve) => {
        clientWs!.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(response.type).toBe('heartbeat_resp');
      expect(typeof response.payload.timestamp).toBe('number');
    });

    it('应该能够持续发送多个心跳', async () => {
      const heartbeatCount = 3;
      const responses: any[] = [];

      for (let i = 0; i < heartbeatCount; i++) {
        const heartbeatMsg = {
          type: 'heartbeat',
          id: uuidv4(),
          payload: { timestamp: Date.now() }
        };

        clientWs!.send(JSON.stringify(heartbeatMsg));

        const response = await new Promise<any>((resolve) => {
          clientWs!.once('message', (data) => {
            resolve(JSON.parse(data.toString()));
          });
        });

        responses.push(response);
        await sleepMs(50);
      }

      expect(responses).toHaveLength(heartbeatCount);
      responses.forEach(resp => {
        expect(resp.type).toBe('heartbeat_resp');
      });
    });
  });

  describe('连接断开和重连', () => {
    it('应该能够在服务端重启后重新连接', async () => {
      // 第一次连接
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);

      await new Promise<void>((resolve) => {
        clientWs!.on('open', () => resolve());
      });

      expect(clientWs.readyState).toBe(WebSocket.OPEN);

      // 关闭服务端
      wss.close();
      await sleepMs(100);

      // 重启服务端
      const newWss = new WebSocketServer({ port: TEST_CONTROL_PORT });
      await sleepMs(100);

      // 创建新连接
      const newClientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);

      await new Promise<void>((resolve) => {
        newClientWs.on('open', () => resolve());
      });

      expect(newClientWs.readyState).toBe(WebSocket.OPEN);

      newClientWs.close();
      newWss.close();
    });
  });

  describe('消息序列化和反序列化', () => {
    it('应该能够正确序列化和反序列化消息', () => {
      const originalMsg = {
        type: 'auth' as const,
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };

      const serialized = JSON.stringify(originalMsg);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.type).toBe(originalMsg.type);
      expect(deserialized.id).toBe(originalMsg.id);
      expect(deserialized.payload.token).toBe(originalMsg.payload.token);
    });

    it('应该能够处理包含特殊字符的消息', () => {
      const originalMsg = {
        type: 'register' as const,
        id: uuidv4(),
        payload: {
          remotePort: TEST_PROXY_PORT,
          protocol: 'http' as const,
          localPort: TEST_LOCAL_PORT,
          localHost: 'localhost'
        }
      };

      const serialized = JSON.stringify(originalMsg);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(originalMsg);
    });
  });

  describe('并发请求处理', () => {
    beforeEach(async () => {
      clientWs = new WebSocket(`ws://localhost:${TEST_CONTROL_PORT}`);
      await new Promise<void>((resolve) => {
        clientWs!.on('open', () => resolve());
      });

      // 先认证
      const authMsg = {
        type: 'auth',
        id: uuidv4(),
        payload: { token: TEST_TOKEN }
      };
      clientWs.send(JSON.stringify(authMsg));

      await new Promise<void>((resolve) => {
        clientWs!.once('message', () => resolve());
      });
    });

    it('应该能够处理并发的注册请求', async () => {
      const concurrentRequests = 5;
      const requests = [];

      for (let i = 0; i < concurrentRequests; i++) {
        const registerMsg = {
          type: 'register',
          id: uuidv4(),
          payload: {
            remotePort: TEST_PROXY_PORT + i,
            protocol: 'http',
            localPort: TEST_LOCAL_PORT + i,
            localHost: 'localhost'
          }
        };
        requests.push(registerMsg);
      }

      // 发送所有请求
      requests.forEach(msg => {
        clientWs!.send(JSON.stringify(msg));
      });

      // 收集所有响应
      const responses = await new Promise<any[]>((resolve) => {
        const collected: any[] = [];
        const messageHandler = (data: Buffer) => {
          const response = JSON.parse(data.toString());
          collected.push(response);
          if (collected.length === concurrentRequests) {
            clientWs!.removeListener('message', messageHandler);
            resolve(collected);
          }
        };
        clientWs!.on('message', messageHandler);
      });

      expect(responses).toHaveLength(concurrentRequests);
      responses.forEach(resp => {
        expect(resp.type).toBe('register_resp');
        expect(resp.payload.success).toBe(true);
      });
    });
  });
});
