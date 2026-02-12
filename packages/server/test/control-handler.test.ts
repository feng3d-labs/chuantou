/**
 * ControlHandler 集成测试
 * 测试通过真实 WebSocket 连接的认证、端口注册、心跳和断连等消息处理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { MessageType, createMessage } from '@feng3d/chuantou-shared';
import { ForwardServer } from '../src/server.js';
import { getRandomPort, connectWs, sendAndWait, authenticate, sleep } from './helpers.js';

const TEST_TOKEN = 'test-token-abc';

describe('ControlHandler', () => {
  let server: ForwardServer;
  let controlPort: number;
  let clients: WebSocket[] = [];

  /** 连接一个 WebSocket 客户端到服务器 */
  async function connect(): Promise<WebSocket> {
    const ws = await connectWs(`ws://127.0.0.1:${controlPort}`);
    clients.push(ws);
    return ws;
  }

  beforeEach(async () => {
    controlPort = await getRandomPort();
    server = new ForwardServer({
      controlPort,
      host: '127.0.0.1',
      authTokens: [TEST_TOKEN],
    });
    await server.start();
    await sleep(50);
    clients = [];
  });

  afterEach(async () => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }
    clients = [];
    await server.stop();
    await sleep(50);
  });

  describe('连接处理', () => {
    it('新连接应该创建会话', async () => {
      await connect();
      await sleep(50);

      const stats = server.getSessionManager().getStats();
      expect(stats.totalClients).toBe(1);
    });
  });

  describe('认证处理', () => {
    it('正确令牌应该认证成功', async () => {
      const ws = await connect();
      const resp = await authenticate(ws, TEST_TOKEN);

      expect(resp.type).toBe(MessageType.AUTH_RESP);
      expect(resp.payload.success).toBe(true);
    });

    it('错误令牌应该认证失败', async () => {
      const ws = await connect();
      const resp = await authenticate(ws, 'wrong-token');

      expect(resp.type).toBe(MessageType.AUTH_RESP);
      expect(resp.payload.success).toBe(false);
      expect(resp.payload.error).toBe('无效的令牌');
    });

    it('空令牌应该返回令牌不能为空', async () => {
      const ws = await connect();
      const msg = createMessage(MessageType.AUTH, { token: '' });
      const resp = await sendAndWait(ws, msg);

      expect(resp.type).toBe(MessageType.AUTH_RESP);
      expect(resp.payload.success).toBe(false);
      expect(resp.payload.error).toBe('令牌不能为空');
    });

    it('认证成功后应该标记客户端为已认证', async () => {
      const ws = await connect();
      await authenticate(ws, TEST_TOKEN);
      await sleep(50);

      const authenticated = server.getSessionManager().getAuthenticatedClients();
      expect(authenticated.length).toBe(1);
    });
  });

  describe('端口注册', () => {
    let ws: WebSocket;

    beforeEach(async () => {
      ws = await connect();
      await authenticate(ws, TEST_TOKEN);
    });

    it('已认证客户端应该能注册HTTP代理', async () => {
      const proxyPort = await getRandomPort();
      const msg = createMessage(MessageType.REGISTER, {
        remotePort: proxyPort,
        localPort: 3000,
        localHost: 'localhost',
      });
      const resp = await sendAndWait(ws, msg);

      expect(resp.type).toBe(MessageType.REGISTER_RESP);
      expect(resp.payload.success).toBe(true);
      expect(resp.payload.remotePort).toBe(proxyPort);
    });

    it('已认证客户端应该能注册代理', async () => {
      const proxyPort = await getRandomPort();
      const msg = createMessage(MessageType.REGISTER, {
        remotePort: proxyPort,
        localPort: 3001,
        localHost: 'localhost',
      });
      const resp = await sendAndWait(ws, msg);

      expect(resp.type).toBe(MessageType.REGISTER_RESP);
      expect(resp.payload.success).toBe(true);
    });

    it('未认证客户端注册应该返回未认证错误', async () => {
      const ws2 = await connect();
      const proxyPort = await getRandomPort();
      const msg = createMessage(MessageType.REGISTER, {
        remotePort: proxyPort,
        localPort: 3000,
      });
      const resp = await sendAndWait(ws2, msg);

      expect(resp.type).toBe(MessageType.REGISTER_RESP);
      expect(resp.payload.success).toBe(false);
      expect(resp.payload.error).toBe('未认证');
    });

    it('端口低于1024应该拒绝', async () => {
      const msg = createMessage(MessageType.REGISTER, {
        remotePort: 80,
        localPort: 3000,
      });
      const resp = await sendAndWait(ws, msg);

      expect(resp.payload.success).toBe(false);
      expect(resp.payload.error).toContain('端口超出范围');
    });

    it('端口高于65535应该拒绝', async () => {
      const msg = createMessage(MessageType.REGISTER, {
        remotePort: 70000,
        localPort: 3000,
      });
      const resp = await sendAndWait(ws, msg);

      expect(resp.payload.success).toBe(false);
      expect(resp.payload.error).toContain('端口超出范围');
    });

    it('已被其他客户端占用的端口应该拒绝', async () => {
      const proxyPort = await getRandomPort();

      // 第一个客户端注册端口
      const registerMsg = createMessage(MessageType.REGISTER, {
        remotePort: proxyPort,
        localPort: 3000,
      });
      const resp1 = await sendAndWait(ws, registerMsg);
      expect(resp1.payload.success).toBe(true);

      // 第二个客户端尝试注册同一端口
      const ws2 = await connect();
      await authenticate(ws2, TEST_TOKEN);
      const resp2 = await sendAndWait(ws2, registerMsg);

      expect(resp2.payload.success).toBe(false);
      expect(resp2.payload.error).toBe('端口已被注册');
    });
  });

  describe('心跳处理', () => {
    it('应该回复心跳响应并附带时间戳', async () => {
      const ws = await connect();
      await authenticate(ws, TEST_TOKEN);

      const msg = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const resp = await sendAndWait(ws, msg);

      expect(resp.type).toBe(MessageType.HEARTBEAT_RESP);
      expect(typeof resp.payload.timestamp).toBe('number');
    });
  });

  describe('断开连接', () => {
    it('客户端断开后应该移除会话', async () => {
      const ws = await connect();
      await authenticate(ws, TEST_TOKEN);
      await sleep(50);

      expect(server.getSessionManager().getStats().totalClients).toBe(1);

      ws.close();
      await sleep(100);

      expect(server.getSessionManager().getStats().totalClients).toBe(0);
    });

    it('客户端断开后应该清理已注册端口', async () => {
      const ws = await connect();
      await authenticate(ws, TEST_TOKEN);

      const proxyPort = await getRandomPort();
      const msg = createMessage(MessageType.REGISTER, {
        remotePort: proxyPort,
        localPort: 3000,
      });
      const resp = await sendAndWait(ws, msg);
      expect(resp.payload.success).toBe(true);

      ws.close();
      await sleep(100);

      // 端口应该被释放
      expect(server.getSessionManager().getClientByPort(proxyPort)).toBeUndefined();
    });
  });

  describe('消息格式错误', () => {
    it('非JSON消息应该返回错误', async () => {
      const ws = await connect();

      const resp = new Promise<any>((resolve) => {
        ws.once('message', (data) => resolve(JSON.parse(data.toString())));
      });
      ws.send('not-json{{{');

      const result = await resp;
      expect(result.type).toBe(MessageType.CONNECTION_ERROR);
      expect(result.payload.error).toContain('无效的消息格式');
    });

    it('未知消息类型应该返回错误', async () => {
      const ws = await connect();

      const msg = { type: 'unknown_type', id: 'test-id', payload: {} };
      const resp = await sendAndWait(ws, msg);

      expect(resp.type).toBe(MessageType.CONNECTION_ERROR);
      expect(resp.payload.error).toContain('未知的消息类型');
    });
  });
});
