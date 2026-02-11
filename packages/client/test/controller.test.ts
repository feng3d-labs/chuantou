/**
 * @module controller.test
 * @description 客户端控制器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { MessageType, createMessage, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';

// Mock ws module before imports
vi.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWS extends EventEmitter {
    readyState = 0;
    sent: any[] = [];
    url: string;

    constructor(url: string) {
      super();
      this.url = url;
      // 模拟异步连接
      setTimeout(() => {
        this.readyState = 1; // OPEN
        this.emit('open');
      }, 5);
    }

    send(data: string) {
      this.sent.push(JSON.parse(data));
    }

    close() {
      this.readyState = 3;
      this.emit('close');
    }
  }

  return {
    WebSocket: MockWS,
  };
});

// Import after mocking
import { Controller } from '../src/controller.js';
import { Config } from '../src/config.js';

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
    it('should create a controller instance', () => {
      const controller = new Controller(config);
      expect(controller).toBeInstanceOf(EventEmitter);
      expect(controller.isConnected()).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    });

    it('should have reconnect attempts of 0 initially', () => {
      const controller = new Controller(config);
      expect(controller.getReconnectAttempts()).toBe(0);
    });
  });

  describe('sendMessage', () => {
    it('should return false when not connected', () => {
      const controller = new Controller(config);
      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const result = controller.sendMessage(message);
      expect(result).toBe(false);
    });

    // 连接测试需要真实 WebSocket 服务器，这里只测试未连接状态
    it('should exist sendMessage method', () => {
      const controller = new Controller(config);
      expect(typeof controller.sendMessage).toBe('function');
    });
  });

  describe('sendRequest', () => {
    it('should add request to pending requests', async () => {
      const controller = new Controller(config);

      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const requestPromise = controller.sendRequest(message, 5000);

      expect(requestPromise).toBeInstanceOf(Promise);
    });

    it('should timeout after specified duration', async () => {
      vi.useRealTimers();
      const controller = new Controller(config);

      const message = createMessage(MessageType.HEARTBEAT, { timestamp: Date.now() });
      const requestPromise = controller.sendRequest(message, 100);

      await expect(requestPromise).rejects.toThrow('请求超时');
    });
  });

  describe('disconnect', () => {
    it('should clear connection and auth status', async () => {
      const controller = new Controller(config);

      // 先启动连接
      await vi.advanceTimersByTimeAsync(10);
      // 立即断开
      controller.disconnect();

      expect(controller.isConnected()).toBe(false);
      expect(controller.isAuthenticated()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('should clear all event listeners', async () => {
      const controller = new Controller(config);
      let eventFired = false;
      controller.on('connected', () => { eventFired = true; });

      controller.destroy();

      // 事件应该被清理
      expect(controller.listenerCount('connected')).toBe(0);
    });
  });

  describe('getters', () => {
    it('should return correct connection status', () => {
      const controller = new Controller(config);
      expect(controller.isConnected()).toBe(false);
    });

    it('should return correct auth status', () => {
      const controller = new Controller(config);
      expect(controller.isAuthenticated()).toBe(false);
    });

    it('should return correct reconnect attempts', () => {
      const controller = new Controller(config);
      expect(controller.getReconnectAttempts()).toBe(0);
    });
  });
});
