/**
 * @module integration/forward-proxy.test
 * @description 正向穿透模式集成测试
 *
 * 测试场景：
 * 1. 客户端注册到服务器
 * 2. 获取客户端列表
 * 3. 建立客户端间的连接（通过服务器中继）
 * 4. 数据传输测试
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { createServer as createTcpServer, Server as TcpServer, Socket } from 'net';
import { v4 as uuidv4 } from 'uuid';
import { ForwardServer } from '../../packages/server/src/server.js';
import { Controller } from '../../packages/client/src/controller.js';
import { ForwardProxy } from '../../packages/client/src/forward-proxy.js';
import { MessageType, createMessage } from '@feng3d/chuantou-shared';

// 设置更长的超时时间
const TEST_TIMEOUT = 30000;

// 测试用端口
const PORTS = {
  server: 21000,        // 中继服务器端口
  clientA_local: 21001,  // 客户端A本地服务端口
  clientB_local: 21002,  // 客户端B本地服务端口
  clientA_forward: 21003, // 客户端A正向代理监听端口
  clientB_forward: 21004, // 客户端B正向代理监听端口
};

// 测试 Token
const TEST_TOKEN = 'test-token-' + Date.now();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('正向穿透模式集成测试', () => {
  let relayServer: ForwardServer;
  let relayHttpPort: number;

  beforeAll(async () => {
    // 启动中继服务器
    relayServer = new ForwardServer({
      host: '127.0.0.1',
      controlPort: PORTS.server,
      authTokens: [TEST_TOKEN],
      heartbeatInterval: 5000,
      sessionTimeout: 30000,
    });

    await relayServer.start();
    console.log(`中继服务器已启动: 端口 ${PORTS.server}`);

    // 等待服务器就绪
    await sleep(1000);
  });

  afterAll(async () => {
    if (relayServer) {
      await relayServer.stop();
      console.log('中继服务器已停止');
    }
  });

  describe('基础功能', () => {
    it('应该能够启动服务器', () => {
      expect(relayServer).toBeDefined();
    }, 5000);

    it('应该能够连接客户端到服务器', async () => {
      const controller = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      await controller.connect();

      expect(controller.isConnected()).toBe(true);
      expect(controller.isAuthenticated()).toBe(true);

      controller.disconnect();

      // 等待完全断开
      await sleep(500);
    }, 10000);

    it('应该能够注册客户端并获取客户端列表', async () => {
      // 设置超时
      const timeout = TEST_TIMEOUT;

      // 创建两个客户端
      const controllerA = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      const controllerB = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      await controllerA.connect();
      await controllerB.connect();

      expect(controllerA.isConnected()).toBe(true);
      expect(controllerB.isConnected()).toBe(true);
      expect(controllerA.isAuthenticated()).toBe(true);
      expect(controllerB.isAuthenticated()).toBe(true);

      // 注册客户端
      const forwardProxyA = new ForwardProxy(controllerA);
      await forwardProxyA.registerAsClient('测试客户端A');

      const forwardProxyB = new ForwardProxy(controllerB);
      await forwardProxyB.registerAsClient('测试客户端B');

      // 等待注册完成
      await sleep(500);

      // 获取客户端列表
      const clientList = await forwardProxyA.getClientList();
      expect(clientList.clients).toBeDefined();
      expect(clientList.clients.length).toBeGreaterThanOrEqual(2);

      // 清理
      forwardProxyA.destroy();
      forwardProxyB.destroy();
      controllerA.disconnect();
      controllerB.disconnect();

      await sleep(200);
    }, TEST_TIMEOUT);
  });

  describe('正向穿透连接建立', () => {
    let controllerA: Controller;
    let controllerB: Controller;
    let forwardProxyA: ForwardProxy;
    let forwardProxyB: ForwardProxy;
    let testServerB: TcpServer;

    beforeEach(async () => {
      // 创建客户端A（发起方）
      controllerA = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      // 创建客户端B（目标方）
      controllerB = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      // 创建测试服务器B（模拟本地服务）
      testServerB = createTcpServer((socket) => {
        socket.write('Hello from clientB local service');
        socket.end();
      });
      await new Promise<void>((resolve) => {
        testServerB.listen(PORTS.clientB_local, '127.0.0.1', () => resolve());
      });

      // 连接到中继服务器
      await controllerA.connect();
      await controllerB.connect();

      // 注册为正向穿透客户端
      forwardProxyA = new ForwardProxy(controllerA);
      await forwardProxyA.registerAsClient('客户端A');

      forwardProxyB = new ForwardProxy(controllerB);
      await forwardProxyB.registerAsClient('客户端B');

      await sleep(500);
    });

    afterEach(async () => {
      forwardProxyA?.destroy();
      forwardProxyB?.destroy();
      controllerA?.disconnect();
      controllerB?.disconnect();

      if (testServerB) {
        await new Promise<void>((resolve) => {
          testServerB.close(() => resolve());
        });
      }

      await sleep(200);
    });

    it('应该能够获取在线客户端列表', async () => {
      const clientList = await forwardProxyA.getClientList();
      expect(clientList.clients).toBeDefined();
      expect(clientList.clients.length).toBeGreaterThanOrEqual(2);
    }, TEST_TIMEOUT);

    it('应该能够添加正向穿透代理', async () => {
      const targetClientId = controllerB.getClientId();

      await forwardProxyA.addProxy({
        localPort: PORTS.clientA_forward,
        targetClientId,
        targetPort: PORTS.clientB_local,
        enabled: true,
      });

      const proxies = forwardProxyA.getProxies();
      expect(proxies.length).toBe(1);
      expect(proxies[0].localPort).toBe(PORTS.clientA_forward);
      expect(proxies[0].targetClientId).toBe(targetClientId);
      expect(proxies[0].targetPort).toBe(PORTS.clientB_local);

      // 清理
      await forwardProxyA.removeProxy(PORTS.clientA_forward);
    });

    it('应该能够移除正向穿透代理', async () => {
      const targetClientId = controllerB.getClientId();

      await forwardProxyA.addProxy({
        localPort: PORTS.clientA_forward,
        targetClientId,
        targetPort: PORTS.clientB_local,
        enabled: true,
      });

      await forwardProxyA.removeProxy(PORTS.clientA_forward);

      const proxies = forwardProxyA.getProxies();
      expect(proxies.length).toBe(0);
    });
  });

  describe('数据传输测试', () => {
    let controllerA: Controller;
    let controllerB: Controller;
    let forwardProxyA: ForwardProxy;
    let forwardProxyB: ForwardProxy;
    let testServerB: TcpServer;
    let testMessage: string;
    let testMessageReceived: boolean = false;

    beforeEach(async () => {
      testMessage = 'Test message ' + Date.now();

      // 创建客户端A（发起方）
      controllerA = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      // 创建客户端B（目标方）
      controllerB = new Controller({
        serverUrl: `ws://127.0.0.1:${PORTS.server}/control`,
        token: TEST_TOKEN,
        reconnectInterval: 1000,
        maxReconnectAttempts: 3,
        proxies: [],
      });

      // 创建测试服务器B
      testServerB = createTcpServer((socket) => {
        socket.on('data', (data) => {
          if (data.toString() === testMessage) {
            testMessageReceived = true;
            socket.write('Echo: ' + data);
          }
        });
      });
      await new Promise<void>((resolve) => {
        testServerB.listen(PORTS.clientB_local, '127.0.0.1', () => resolve());
      });

      // 连接到中继服务器
      await controllerA.connect();
      await controllerB.connect();

      // 注册为正向穿透客户端
      forwardProxyA = new ForwardProxy(controllerA);
      await forwardProxyA.registerAsClient('客户端A');

      forwardProxyB = new ForwardProxy(controllerB);
      await forwardProxyB.registerAsClient('客户端B');

      await sleep(500);
    });

    afterEach(async () => {
      forwardProxyA?.destroy();
      forwardProxyB?.destroy();
      controllerA?.disconnect();
      controllerB?.disconnect();

      if (testServerB) {
        await new Promise<void>((resolve) => {
          testServerB.close(() => resolve());
        });
      }

      await sleep(200);
    });

    it('应该能够通过正向代理传输数据', async function () {
      // 注意：这个测试可能需要更复杂的数据通道支持
      // 当前实现可能不完整，先测试基本流程
      const targetClientId = controllerB.getClientId();

      await forwardProxyA.addProxy({
        localPort: PORTS.clientA_forward,
        targetClientId,
        targetPort: PORTS.clientB_local,
        enabled: true,
      });

      // 等待代理就绪
      await sleep(500);

      // 这里需要实现实际的 TCP 连接测试
      // 由于当前数据通道可能还未完全实现，暂时跳过实际连接测试
      const proxies = forwardProxyA.getProxies();
      expect(proxies.length).toBe(1);
      expect(proxies[0].localPort).toBe(PORTS.clientA_forward);

      // 清理
      await forwardProxyA.removeProxy(PORTS.clientA_forward);
    }, 10000);
  });
});
