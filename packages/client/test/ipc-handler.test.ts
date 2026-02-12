/**
 * @module ipc-handler.test
 * @description IPC 请求处理器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { IpcHandler } from '../src/ipc-handler.js';
import { Controller } from '../src/controller.js';
import { ProxyManager } from '../src/proxy-manager.js';
import { Config } from '../src/config.js';
import { ProxyConfig } from '@feng3d/chuantou-shared';

// Mock unified-handler to avoid real connections
vi.mock('../src/handlers/unified-handler.js', () => ({
  UnifiedHandler: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    destroy: vi.fn(),
  })),
}));

describe('IpcHandler', () => {
  let requestDir: string;
  let config: Config;
  let controller: Controller;
  let proxyManager: ProxyManager;
  let registeredProxies: ProxyConfig[];
  let ipcHandler: IpcHandler;

  beforeEach(() => {
    vi.clearAllMocks();

    // 使用临时目录避免影响真实文件系统
    requestDir = join(tmpdir(), `chuantou-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    mkdirSync(requestDir, { recursive: true });

    config = new Config({
      serverUrl: 'ws://localhost:9000',
      token: 'test-token',
      reconnectInterval: 1000,
      maxReconnectAttempts: 3,
      proxies: [],
    });

    controller = new Controller(config);
    proxyManager = new ProxyManager(controller);
    registeredProxies = [];

    ipcHandler = new IpcHandler({
      requestDir,
      controller,
      proxyManager,
      registeredProxies,
    });
  });

  afterEach(() => {
    ipcHandler.stop();
    // 清理临时目录
    try {
      rmSync(requestDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('handleRequest', () => {
    it('应该成功处理添加代理请求并写入成功响应', async () => {
      // Mock controller 和 proxyManager
      vi.spyOn(controller, 'isAuthenticated').mockReturnValue(true);
      vi.spyOn(proxyManager, 'registerProxy').mockResolvedValue();

      const requestId = 'test-req-1';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      const proxy: ProxyConfig = { remotePort: 8080, localPort: 3000, localHost: 'localhost' };
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      await ipcHandler.handleRequest(requestPath);

      // 验证响应文件已写入
      expect(existsSync(responsePath)).toBe(true);
      const response = JSON.parse(readFileSync(responsePath, 'utf-8'));
      expect(response.success).toBe(true);

      // 验证 registerProxy 被调用
      expect(proxyManager.registerProxy).toHaveBeenCalledWith(proxy);

      // 验证 registeredProxies 已更新
      expect(registeredProxies).toHaveLength(1);
      expect(registeredProxies[0]).toEqual(proxy);
    });

    it('应该在控制器未认证时写入错误响应而非超时等待', async () => {
      vi.spyOn(controller, 'isAuthenticated').mockReturnValue(false);

      const requestId = 'test-req-unauth';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      const proxy: ProxyConfig = { remotePort: 8080, localPort: 3000, localHost: 'localhost' };
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      await ipcHandler.handleRequest(requestPath);

      // 验证响应文件已写入错误信息
      expect(existsSync(responsePath)).toBe(true);
      const response = JSON.parse(readFileSync(responsePath, 'utf-8'));
      expect(response.success).toBe(false);
      expect(response.error).toContain('未连接');

      // 验证 registerProxy 未被调用
      expect(vi.spyOn(proxyManager, 'registerProxy')).not.toHaveBeenCalled();
    });

    it('应该在 registerProxy 失败时写入错误响应', async () => {
      vi.spyOn(controller, 'isAuthenticated').mockReturnValue(true);
      vi.spyOn(proxyManager, 'registerProxy').mockRejectedValue(new Error('注册代理失败: 端口已被占用'));

      const requestId = 'test-req-fail';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      const proxy: ProxyConfig = { remotePort: 8080, localPort: 3000, localHost: 'localhost' };
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      await ipcHandler.handleRequest(requestPath);

      // 验证响应文件已写入错误
      expect(existsSync(responsePath)).toBe(true);
      const response = JSON.parse(readFileSync(responsePath, 'utf-8'));
      expect(response.success).toBe(false);
      expect(response.error).toContain('端口已被占用');
    });

    it('应该在请求文件解析失败时仍然写入错误响应', async () => {
      const requestId = 'test-req-invalid';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      // 写入无效 JSON
      writeFileSync(requestPath, 'invalid json {{{');

      await ipcHandler.handleRequest(requestPath);

      // 验证即使 JSON 解析失败，也写入了错误响应
      expect(existsSync(responsePath)).toBe(true);
      const response = JSON.parse(readFileSync(responsePath, 'utf-8'));
      expect(response.success).toBe(false);
      expect(response.error).toBeTruthy();
    });

    it('应该忽略非 add-proxy 类型的请求', async () => {
      const requestId = 'test-req-unknown';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      writeFileSync(requestPath, JSON.stringify({ type: 'unknown-type', timestamp: Date.now() }));

      await ipcHandler.handleRequest(requestPath);

      // 不应写入响应文件
      expect(existsSync(responsePath)).toBe(false);
    });
  });

  describe('checkRequests', () => {
    it('应该发现并处理请求目录中的 .json 文件', async () => {
      vi.spyOn(controller, 'isAuthenticated').mockReturnValue(true);
      vi.spyOn(proxyManager, 'registerProxy').mockResolvedValue();

      const requestId = 'test-check-1';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      const proxy: ProxyConfig = { remotePort: 9090, localPort: 4000, localHost: 'localhost' };
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      // 调用 checkRequests
      ipcHandler.checkRequests();

      // 等待异步处理完成
      await vi.waitFor(() => {
        expect(existsSync(responsePath)).toBe(true);
      });

      const response = JSON.parse(readFileSync(responsePath, 'utf-8'));
      expect(response.success).toBe(true);
    });

    it('应该跳过正在处理中的文件防止重复处理', async () => {
      // 使用一个延迟的 registerProxy 来模拟长时间处理
      let resolveRegister: () => void;
      const registerPromise = new Promise<void>((resolve) => {
        resolveRegister = resolve;
      });
      vi.spyOn(controller, 'isAuthenticated').mockReturnValue(true);
      const registerSpy = vi.spyOn(proxyManager, 'registerProxy').mockReturnValue(registerPromise);

      const requestId = 'test-dedup';
      const requestPath = join(requestDir, `${requestId}.json`);

      const proxy: ProxyConfig = { remotePort: 7070, localPort: 5000, localHost: 'localhost' };
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      // 第一次 checkRequests - 开始处理
      ipcHandler.checkRequests();

      // 第二次 checkRequests - 应该跳过同一文件
      ipcHandler.checkRequests();

      // registerProxy 应该只被调用一次
      expect(registerSpy).toHaveBeenCalledTimes(1);

      // 完成注册
      resolveRegister!();
      await registerPromise;
    });

    it('应该在文件处理完成后允许重新处理', async () => {
      vi.spyOn(controller, 'isAuthenticated').mockReturnValue(true);
      const registerSpy = vi.spyOn(proxyManager, 'registerProxy').mockResolvedValue();

      const requestId = 'test-reprocess';
      const requestPath = join(requestDir, `${requestId}.json`);
      const responsePath = join(requestDir, `${requestId}.resp`);

      const proxy: ProxyConfig = { remotePort: 6060, localPort: 6000, localHost: 'localhost' };
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      // 第一次处理
      ipcHandler.checkRequests();
      await vi.waitFor(() => {
        expect(existsSync(responsePath)).toBe(true);
      });

      // 重新写入同名请求文件（模拟文件被重新创建）
      writeFileSync(requestPath, JSON.stringify({ type: 'add-proxy', proxy, timestamp: Date.now() }));

      // 第二次处理 - 文件已从 processingFiles 中移除，应该可以重新处理
      ipcHandler.checkRequests();
      await vi.waitFor(() => {
        expect(registerSpy).toHaveBeenCalledTimes(2);
      });
    });

    it('应该忽略 .resp 文件和非 .json 文件', async () => {
      const handleSpy = vi.spyOn(ipcHandler, 'handleRequest');

      // 写入非请求文件
      writeFileSync(join(requestDir, 'test.resp'), '{}');
      writeFileSync(join(requestDir, 'test.txt'), 'hello');

      ipcHandler.checkRequests();

      expect(handleSpy).not.toHaveBeenCalled();
    });
  });

  describe('start / stop', () => {
    it('应该启动和停止定时器', () => {
      ipcHandler.start();
      // start 不应该抛出异常
      expect(() => ipcHandler.stop()).not.toThrow();
    });

    it('应该可以多次安全调用 stop', () => {
      ipcHandler.start();
      ipcHandler.stop();
      expect(() => ipcHandler.stop()).not.toThrow();
    });
  });
});
