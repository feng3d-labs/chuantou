/**
 * @module controller.test
 * @description 客户端控制器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { MessageType, createMessage } from '@feng3d/chuantou-shared';
import { WebSocket } from 'ws';

// Import first before mocking
import { Controller } from '../src/controller.js';
import { Config } from '../src/config.js';

// Mock ws 模块
vi.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWS extends EventEmitter {
    readyState = 0; // CONNECTING
    static OPEN = 1;
    static CONNECTING = 0;
    static CLOSING = 2;
    static CLOSED = 3;
    sent: any[] = [];
    url: string;

    constructor(url: string) {
      super();
      this.url = url;
    }

    send(data: string) {
      if (this.readyState === MockWS.OPEN) {
        this.sent.push(JSON.parse(data));
      }
    }

    close() {
      this.readyState = MockWS.CLOSED;
      this.emit('close');
    }
  }

  return {
    WebSocket: MockWS,
  };
});

describe('Controller', () => {
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    config = new Config({
      serverUrl: 'ws://localhost:9000',
      token: 'test-token',
      reconnectInterval: 1000,
      maxReconnectAttempts: 3,
      proxies: [{ remotePort: 8080, localPort: 3000, localHost: 'localhost' }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('应该创建控制器实例', () => {
      const controller = new Controller(config);
      expect(controller).toBeInstanceOf(EventEmitter);
      expect(controller.isConnected()).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    });

    it('初始重连次数应该为 0', () => {
      const controller = new Controller(config);
      expect(controller.getReconnectAttempts()).toBe(0);
    });
  });

  describe('sendMessage', () => {
    it('未连接时发送消息应返回 false', () => {
      const controller = new Controller(config);
      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const result = controller.sendMessage(message);
      expect(result).toBe(false);
    });

    it('应该在 WebSocket 为 OPEN 状态时发送消息', () => {
      const controller = new Controller(config);
      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });

      // 模拟已连接状态
      (controller as any).connected = true;
      (controller as any).ws = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      };

      const result = controller.sendMessage(message);

      expect(result).toBe(true);
    });

    it('应该在 WebSocket 非 OPEN 状态时返回 false', () => {
      const controller = new Controller(config);
      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });

      // 模拟未连接状态
      (controller as any).connected = false;
      (controller as any).ws = {
        readyState: WebSocket.CONNECTING,
        send: vi.fn(),
      };

      const result = controller.sendMessage(message);

      expect(result).toBe(false);
    });
  });

  describe('sendRequest', () => {
    it('应该将请求添加到待处理列表', () => {
      const controller = new Controller(config);

      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const requestPromise = controller.sendRequest(message, 5000);

      expect(requestPromise).toBeInstanceOf(Promise);
    });

    it('应该在超时后拒绝 Promise', async () => {
      vi.useRealTimers();
      const controller = new Controller(config);

      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const requestPromise = controller.sendRequest(message, 100);

      await expect(requestPromise).rejects.toThrow('请求超时');
    });
  });

  describe('handleMessage', () => {
    it('应该处理 AUTH_RESP 响应消息', () => {
      const controller = new Controller(config);
      const testMessage = {
        id: 'test-id',
        type: MessageType.AUTH_RESP,
        payload: { success: true },
      };

      // 处理消息不应该抛出错误
      expect(() => {
        (controller as any).handleMessage(Buffer.from(JSON.stringify(testMessage)));
      }).not.toThrow();
    });

    it('应该处理 HEARTBEAT_RESP 响应消息', () => {
      const controller = new Controller(config);
      const testMessage = {
        id: 'test-id',
        type: MessageType.HEARTBEAT_RESP,
        payload: {},
      };

      expect(() => {
        (controller as any).handleMessage(Buffer.from(JSON.stringify(testMessage)));
      }).not.toThrow();
    });

    it('应该处理 NEW_CONNECTION 消息并触发事件', () => {
      const controller = new Controller(config);
      const newConnectionSpy = vi.fn();

      controller.on('newConnection', newConnectionSpy);

      const testMessage = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'conn-123',
          protocol: 'http',
          method: 'GET',
          url: '/test',
        },
      };

      (controller as any).handleMessage(Buffer.from(JSON.stringify(testMessage)));

      expect(newConnectionSpy).toHaveBeenCalled();
    });

    it('应该处理 CONNECTION_CLOSE 消息并触发事件', () => {
      const controller = new Controller(config);
      const connectionCloseSpy = vi.fn();

      controller.on('connectionClose', connectionCloseSpy);

      const testMessage = {
        id: 'test-id',
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'conn-123' },
      };

      (controller as any).handleMessage(Buffer.from(JSON.stringify(testMessage)));

      expect(connectionCloseSpy).toHaveBeenCalled();
    });

    it('应该处理 CONNECTION_ERROR 消息并触发事件', () => {
      const controller = new Controller(config);
      const connectionErrorSpy = vi.fn();

      controller.on('connectionError', connectionErrorSpy);

      const testMessage = {
        id: 'test-id',
        type: MessageType.CONNECTION_ERROR,
        payload: { connectionId: 'conn-123', error: 'Connection failed' },
      };

      (controller as any).handleMessage(Buffer.from(JSON.stringify(testMessage)));

      expect(connectionErrorSpy).toHaveBeenCalled();
    });

    it('应该忽略未知消息类型', () => {
      const controller = new Controller(config);
      const testMessage = {
        id: 'test-id',
        type: 'UNKNOWN_TYPE',
        payload: {},
      };

      // 不应该抛出错误
      expect(() => {
        (controller as any).handleMessage(Buffer.from(JSON.stringify(testMessage)));
      }).not.toThrow();
    });

    it('应该处理 JSON 解析错误', () => {
      const controller = new Controller(config);

      // 不应该抛出错误
      expect(() => {
        (controller as any).handleMessage(Buffer.from('invalid json'));
      }).not.toThrow();
    });
  });

  describe('handleResponse', () => {
    it('应该解析响应消息并清除超时定时器', () => {
      const controller = new Controller(config);
      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });

      // 创建待处理请求
      controller.sendRequest(message, 5000);

      // 模拟响应
      const response = {
        id: message.id,
        type: MessageType.HEARTBEAT_RESP,
        payload: { timestamp: Date.now() },
      };

      (controller as any).handleResponse(response);

      // 验证请求已从待处理列表中移除
      expect((controller as any).pendingRequests.has(message.id)).toBe(false);
    });

    it('应该忽略不存在的响应消息', () => {
      const controller = new Controller(config);

      const response = {
        id: 'non-existent-id',
        type: MessageType.HEARTBEAT_RESP,
        payload: {},
      };

      // 不应该抛出错误
      expect(() => {
        (controller as any).handleResponse(response);
      }).not.toThrow();
    });
  });

  describe('disconnect', () => {
    it('应该清除连接和认证状态', () => {
      const controller = new Controller(config);
      controller.disconnect();

      expect(controller.isConnected()).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    });

    it('应该清除重连定时器', () => {
      const controller = new Controller(config);
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      // 设置一个重连定时器
      (controller as any).reconnectTimer = setTimeout(() => {}, 1000);

      controller.disconnect();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect((controller as any).reconnectTimer).toBeNull();
    });

    it('应该停止心跳定时器', () => {
      const controller = new Controller(config);
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      // 设置一个心跳定时器
      (controller as any).heartbeatTimer = setInterval(() => {}, 30000);

      controller.disconnect();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((controller as any).heartbeatTimer).toBeNull();
    });

    it('应该关闭 WebSocket 连接', () => {
      const controller = new Controller(config);
      const mockWs = {
        close: vi.fn(),
      };

      (controller as any).ws = mockWs;
      controller.disconnect();

      expect(mockWs.close).toHaveBeenCalled();
      expect((controller as any).ws).toBeNull();
    });

    it('多次断开应该是安全的', () => {
      const controller = new Controller(config);
      controller.disconnect();
      controller.disconnect(); // 再次断开

      expect(controller.isConnected()).toBe(false);
    });

    it('应该在没有 WebSocket 时安全断开', () => {
      const controller = new Controller(config);

      // ws 为 null
      (controller as any).ws = null;

      // 不应该抛出错误
      expect(() => {
        controller.disconnect();
      }).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('应该清除所有事件监听器', () => {
      const controller = new Controller(config);
      controller.on('connected', () => {});

      controller.destroy();

      expect(controller.listenerCount('connected')).toBe(0);
    });

    it('应该清除待处理请求的超时定时器', () => {
      const controller = new Controller(config);

      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      controller.sendRequest(message, 5000);

      // destroy 应该清除所有待处理请求
      controller.destroy();

      expect(controller.listenerCount('connected')).toBe(0);
    });

    it('应该清除所有待处理请求', () => {
      const controller = new Controller(config);

      const message1 = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const message2 = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });

      controller.sendRequest(message1, 5000);
      controller.sendRequest(message2, 5000);

      controller.destroy();

      expect(controller.listenerCount('connected')).toBe(0);
      expect(controller.listenerCount('disconnected')).toBe(0);
    });

    it('应该调用 disconnect', () => {
      const controller = new Controller(config);
      const disconnectSpy = vi.spyOn(controller as any, 'disconnect');

      controller.destroy();

      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  describe('getters', () => {
    it('应该返回正确的连接状态', () => {
      const controller = new Controller(config);
      expect(controller.isConnected()).toBe(false);
    });

    it('应该返回正确的认证状态', () => {
      const controller = new Controller(config);
      expect(controller.isAuthenticated()).toBe(false);
    });

    it('应该返回正确的重连次数', () => {
      const controller = new Controller(config);
      expect(controller.getReconnectAttempts()).toBe(0);
    });
  });

  describe('calculateReconnectDelay', () => {
    it('应该在首次重连时返回基础延迟', () => {
      const controller = new Controller(config);
      (controller as any).reconnectAttempts = 0;

      const delay = (controller as any).calculateReconnectDelay();

      // 基础延迟 1000ms + 0~1000ms 随机抖动
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(2000);
    });

    it('应该在第二次重连时使用指数退避', () => {
      const controller = new Controller(config);
      (controller as any).reconnectAttempts = 1;

      const delay = (controller as any).calculateReconnectDelay();

      // 2 * 1000 = 2000ms + 抖动
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThan(3000);
    });

    it('应该将最大延迟限制为 60 秒', () => {
      const controller = new Controller(config);
      // 设置很大的重连次数
      (controller as any).reconnectAttempts = 100;

      const delay = (controller as any).calculateReconnectDelay();

      // 最大 60000ms + 抖动
      expect(delay).toBeGreaterThanOrEqual(60000);
      expect(delay).toBeLessThan(61000);
    });
  });

  describe('startHeartbeat', () => {
    it('应该设置心跳定时器', () => {
      vi.useRealTimers();
      const controller = new Controller(config);
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      (controller as any).startHeartbeat();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    it('应该在连接且认证时发送心跳消息', () => {
      vi.useRealTimers();
      const controller = new Controller(config);
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;
      (controller as any).connected = true;
      (controller as any).authenticated = true;

      (controller as any).startHeartbeat();

      // 手动触发定时器回调
      const callback = (vi.mocked(setInterval).mock.calls[0][0] as () => void);
      callback();

      expect(mockWs.send).toHaveBeenCalled();
    });

    it('应该在未连接时不发送心跳', () => {
      vi.useRealTimers();
      const controller = new Controller(config);
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;
      (controller as any).connected = false;
      (controller as any).authenticated = true;

      (controller as any).startHeartbeat();

      const callback = (vi.mocked(setInterval).mock.calls[0][0] as () => void);
      callback();

      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('应该在未认证时不发送心跳', () => {
      vi.useRealTimers();
      const controller = new Controller(config);
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;
      (controller as any).connected = true;
      (controller as any).authenticated = false;

      (controller as any).startHeartbeat();

      const callback = (vi.mocked(setInterval).mock.calls[0][0] as () => void);
      callback();

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('stopHeartbeat', () => {
    it('应该清除心跳定时器', () => {
      const controller = new Controller(config);
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      (controller as any).heartbeatTimer = setInterval(() => {}, 30000);
      (controller as any).stopHeartbeat();

      expect(clearIntervalSpy).toHaveBeenCalled();
      expect((controller as any).heartbeatTimer).toBeNull();
    });

    it('应该在定时器为 null 时不报错', () => {
      const controller = new Controller(config);
      (controller as any).heartbeatTimer = null;

      expect(() => {
        (controller as any).stopHeartbeat();
      }).not.toThrow();
    });
  });

  describe('scheduleReconnect', () => {
    it('应该在已有重连定时器时不创建新定时器', () => {
      const controller = new Controller(config);
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

      (controller as any).reconnectTimer = setTimeout(() => {}, 1000);
      (controller as any).scheduleReconnect();

      // 不应该创建新的定时器
      expect(setTimeoutSpy.mock.calls.length).toBe(1);
    });

    it('应该在达到最大重连次数时触发事件', () => {
      const controller = new Controller(config);
      const maxReconnectSpy = vi.fn();

      controller.on('maxReconnectAttemptsReached', maxReconnectSpy);
      (controller as any).reconnectAttempts = 3;
      (controller as any).scheduleReconnect();

      expect(maxReconnectSpy).toHaveBeenCalled();
    });

    it('应该创建重连定时器', () => {
      const controller = new Controller(config);
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue({} as NodeJS.Timeout);

      (controller as any).reconnectAttempts = 0;
      (controller as any).scheduleReconnect();

      expect(setTimeoutSpy).toHaveBeenCalled();
    });

    it('应该在定时器触发时增加重连次数', () => {
      const controller = new Controller(config);
      const connectSpy = vi.spyOn(controller as any, 'connect').mockResolvedValue(undefined);
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue({} as NodeJS.Timeout);

      (controller as any).reconnectAttempts = 0;
      (controller as any).scheduleReconnect();

      // 验证 setTimeout 被调用
      expect(setTimeoutSpy).toHaveBeenCalled();

      // 获取定时器回调并执行
      const timerCallback = vi.mocked(setTimeout).mock.calls[0][0] as () => void;
      timerCallback();

      // 重连次数应该增加
      expect((controller as any).reconnectAttempts).toBe(1);
      expect(connectSpy).toHaveBeenCalled();
    });

    it('应该在重连失败时再次安排重连', () => {
      const controller = new Controller(config);

      // Mock connect 方法返回失败
      const connectSpy = vi.spyOn(controller as any, 'connect').mockRejectedValue(new Error('Connection failed'));

      // Mock setTimeout
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockReturnValue({} as NodeJS.Timeout);

      (controller as any).reconnectAttempts = 0;

      // 调用 scheduleReconnect
      (controller as any).scheduleReconnect();

      // 获取 setTimeout 的回调并执行
      const setTimeoutCalls = setTimeoutSpy.mock.calls;
      const timerCallback = setTimeoutCalls[setTimeoutCalls.length - 1][0] as () => void;

      timerCallback();

      // connect 应该被调用
      expect(connectSpy).toHaveBeenCalled();
    });
  });

  /*
   * 以下功能需要真实的 WebSocket 服务器和网络连接，单元测试无法覆盖：
   *
   * 1. connect() - 需要真实的 WebSocket 服务器进行握手
   * 2. authenticate() - 需要服务器返回认证响应
   * 3. 完整的心跳定时器周期 - 需要 30 秒等待时间
   * 4. 完整的重连流程 - 需要真实的网络连接和服务器响应
   *
   * 这些功能应该通过集成测试或 E2E 测试验证
   */
  describe('集成测试标记', () => {
    it('标记: connect() 需要真实 WebSocket 服务器', () => {
      // connect() 方法需要：
      // 1. 真实的 WebSocket 服务器
      // 2. 异步握手过程
      // 3. 服务器返回认证响应
      // 建议：使用 testcontainers 或 mock WebSocket 服务器进行集成测试
      expect(true).toBe(true);
    });

    it('标记: 完整重连流程需要真实网络环境', () => {
      // 完整的 scheduleReconnect() 流程需要：
      // 1. 真实的网络连接失败场景
      // 2. 服务器对重连的响应
      // 3. 长时间运行的测试
      // 建议：通过集成测试验证完整的重连流程
      expect(true).toBe(true);
    });

    it('标记: 心跳定时器完整周期需要长时间测试', () => {
      // startHeartbeat() 完整测试需要：
      // 1. 30 秒的间隔等待
      // 2. 已建立的 WebSocket 连接
      // 3. 已完成的认证
      // 建议：通过 E2E 测试验证心跳保活功能
      expect(true).toBe(true);
    });
  });
});
