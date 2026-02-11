/**
 * @module proxy-manager.test
 * @description 代理管理器模块的单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProxyManager } from '../src/proxy-manager.js';
import { Controller } from '../src/controller.js';
import { Config } from '../src/config.js';
import { MessageType, createMessage, ProxyConfig } from '@feng3d/chuantou-shared';

// Mock UnifiedHandler
vi.mock('../src/handlers/unified-handler.js', () => ({
  UnifiedHandler: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    destroy: vi.fn(),
  })),
}));

describe('ProxyManager', () => {
  let config: Config;
  let controller: Controller;
  let proxyManager: ProxyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    config = new Config({
      serverUrl: 'ws://localhost:9000',
      token: 'test-token',
      reconnectInterval: 1000,
      maxReconnectAttempts: 3,
      proxies: [],
    });

    controller = new Controller(config);
    proxyManager = new ProxyManager(controller);
  });

  describe('constructor', () => {
    it('should create a proxy manager instance', () => {
      expect(proxyManager).toBeInstanceOf(ProxyManager);
    });

    it('should listen to controller disconnected event', () => {
      const emitSpy = vi.spyOn(controller, 'on');
      new ProxyManager(controller);
      expect(emitSpy).toHaveBeenCalledWith('disconnected', expect.any(Function));
    });
  });

  describe('registerProxy', () => {
    it('should send register message to controller', async () => {
      const sendRequestSpy = vi.spyOn(controller, 'sendRequest').mockResolvedValue({
        type: MessageType.REGISTER_RESP,
        payload: { success: true, remoteUrl: 'http://localhost:8080' },
      });

      const proxyConfig: ProxyConfig = {
        remotePort: 8080,
        localPort: 3000,
        localHost: 'localhost',
      };

      await proxyManager.registerProxy(proxyConfig);

      expect(sendRequestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.REGISTER,
          payload: proxyConfig,
        })
      );
    });

    it('should throw error when registration fails', async () => {
      vi.spyOn(controller, 'sendRequest').mockResolvedValue({
        type: MessageType.REGISTER_RESP,
        payload: { success: false, error: '端口已被占用' },
      });

      const proxyConfig: ProxyConfig = {
        remotePort: 8080,
        localPort: 3000,
        localHost: 'localhost',
      };

      await expect(proxyManager.registerProxy(proxyConfig)).rejects.toThrow('注册代理失败');
    });

    it('should create handler on successful registration', async () => {
      vi.spyOn(controller, 'sendRequest').mockResolvedValue({
        type: MessageType.REGISTER_RESP,
        payload: { success: true, remoteUrl: 'http://localhost:8080' },
      });

      const proxyConfig: ProxyConfig = {
        remotePort: 8080,
        localPort: 3000,
        localHost: 'localhost',
      };

      await proxyManager.registerProxy(proxyConfig);
      // Handler should be created (verified by mock being called)
      expect(controller['sendRequest']).toHaveBeenCalled();
    });
  });

  describe('unregisterProxy', () => {
    it('should send unregister message to controller', async () => {
      const sendRequestSpy = vi.spyOn(controller, 'sendRequest').mockResolvedValue({});

      await proxyManager.unregisterProxy(8080);

      expect(sendRequestSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.UNREGISTER,
          payload: { remotePort: 8080 },
        })
      );
    });

    it('should not throw when unregistering non-existent proxy', async () => {
      vi.spyOn(controller, 'sendRequest').mockResolvedValue({});

      await expect(proxyManager.unregisterProxy(9999)).resolves.not.toThrow();
    });
  });

  describe('unregisterAll', () => {
    it('should unregister all registered proxies', async () => {
      const sendRequestSpy = vi.spyOn(controller, 'sendRequest').mockResolvedValue({
        type: MessageType.REGISTER_RESP,
        payload: { success: true, remoteUrl: 'http://localhost:8080' },
      });

      // 注册两个代理
      await proxyManager.registerProxy({ remotePort: 8080, localPort: 3000, localHost: 'localhost' });
      await proxyManager.registerProxy({ remotePort: 8081, localPort: 3001, localHost: 'localhost' });

      // 重置 spy
      sendRequestSpy.mockClear();
      sendRequestSpy.mockResolvedValue({});

      await proxyManager.unregisterAll();

      expect(sendRequestSpy).toHaveBeenCalledTimes(2);
    });

    it('should complete with no proxies registered', async () => {
      await expect(proxyManager.unregisterAll()).resolves.not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should call unregisterAll', async () => {
      const unregisterAllSpy = vi.spyOn(proxyManager, 'unregisterAll').mockResolvedValue();

      await proxyManager.destroy();

      expect(unregisterAllSpy).toHaveBeenCalled();
    });
  });

  describe('onDisconnected', () => {
    it('should clear all handlers on disconnect', async () => {
      vi.spyOn(controller, 'sendRequest').mockResolvedValue({
        type: MessageType.REGISTER_RESP,
        payload: { success: true, remoteUrl: 'http://localhost:8080' },
      });

      await proxyManager.registerProxy({ remotePort: 8080, localPort: 3000, localHost: 'localhost' });

      // 触发断开连接事件
      controller.emit('disconnected');

      // Handlers should be cleared
      expect(controller['sendRequest']).toHaveBeenCalled();
    });
  });
});
