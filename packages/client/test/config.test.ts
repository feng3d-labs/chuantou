/**
 * @module config.test
 * @description 客户端配置模块的单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { Config } from '../src/config.js';
import { ClientConfig, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';

// Mock fs 模块
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
    },
  };
});

describe('Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置 process.argv
    process.argv = ['node', 'cli.js'];
  });

  describe('parseProxies', () => {
    it('should parse single proxy without localHost', async () => {
      process.argv = ['node', 'cli.js', '--proxies', '8080:3000'];
      const config = await Config.load();
      expect(config.proxies).toEqual([
        { remotePort: 8080, localPort: 3000, localHost: 'localhost' },
      ]);
    });

    it('should parse single proxy with localHost', async () => {
      process.argv = ['node', 'cli.js', '--proxies', '8080:3000:192.168.1.100'];
      const config = await Config.load();
      expect(config.proxies).toEqual([
        { remotePort: 8080, localPort: 3000, localHost: '192.168.1.100' },
      ]);
    });

    it('should parse multiple proxies', async () => {
      process.argv = ['node', 'cli.js', '--proxies', '8080:3000,8081:3001:localhost,8082:3002'];
      const config = await Config.load();
      expect(config.proxies).toEqual([
        { remotePort: 8080, localPort: 3000, localHost: 'localhost' },
        { remotePort: 8081, localPort: 3001, localHost: 'localhost' },
        { remotePort: 8082, localPort: 3002, localHost: 'localhost' },
      ]);
    });
  });

  describe('parseArgs', () => {
    it('should parse --server argument', async () => {
      process.argv = ['node', 'cli.js', '--server', 'ws://example.com:9000'];
      const config = await Config.load();
      expect(config.serverUrl).toBe('ws://example.com:9000');
    });

    it('should parse --token argument', async () => {
      process.argv = ['node', 'cli.js', '--token', 'my-secret-token'];
      const config = await Config.load();
      expect(config.token).toBe('my-secret-token');
    });

    it('should parse all arguments', async () => {
      process.argv = [
        'node',
        'cli.js',
        '--server',
        'wss://example.com:9000',
        '--token',
        'secret',
        '--proxies',
        '8080:3000',
      ];
      const config = await Config.load();
      expect(config.serverUrl).toBe('wss://example.com:9000');
      expect(config.token).toBe('secret');
      expect(config.proxies).toEqual([
        { remotePort: 8080, localPort: 3000, localHost: 'localhost' },
      ]);
    });

    it('should parse --config argument', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
        serverUrl: 'ws://config.com:9000',
        token: 'config-token',
      }));

      process.argv = ['node', 'cli.js', '--config', '/custom/config.json'];
      const config = await Config.load();
      expect(config.serverUrl).toBe('ws://config.com:9000');
      expect(config.token).toBe('config-token');
    });
  });

  describe('loadFromFile', () => {
    it('should load config from file when it exists', async () => {
      const fileConfig = {
        serverUrl: 'ws://file.com:9000',
        token: 'file-token',
        proxies: [{ remotePort: 9000, localPort: 8080, localHost: 'localhost' }],
      };
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(fileConfig));

      process.argv = ['node', 'cli.js'];
      const config = await Config.load();
      expect(config.serverUrl).toBe('ws://file.com:9000');
      expect(config.token).toBe('file-token');
    });

    it('should use default values when file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('File not found'));

      process.argv = ['node', 'cli.js'];
      const config = await Config.load();
      expect(config.serverUrl).toBeTruthy();
      expect(config.token).toBeTruthy();
    });

    it('should override file config with command line args', async () => {
      const fileConfig = {
        serverUrl: 'ws://file.com:9000',
        token: 'file-token',
      };
      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(fileConfig));

      process.argv = ['node', 'cli.js', '--server', 'ws://cli.com:9000'];
      const config = await Config.load();
      expect(config.serverUrl).toBe('ws://cli.com:9000'); // CLI 覆盖文件
      expect(config.token).toBe('file-token'); // 文件中的值保留
    });
  });

  describe('validate', () => {
    it('should pass validation with valid config', () => {
      const config = new Config({
        serverUrl: 'ws://localhost:9000',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 8080, localPort: 3000, localHost: 'localhost' }],
      });
      expect(() => config.validate()).not.toThrow();
    });

    it('should throw error when serverUrl is empty', () => {
      const config = new Config({
        serverUrl: '',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 8080, localPort: 3000, localHost: 'localhost' }],
      });
      expect(() => config.validate()).toThrow('服务器地址是必需的');
    });

    it('should throw error when token is empty', () => {
      const config = new Config({
        serverUrl: 'ws://localhost:9000',
        token: '',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 8080, localPort: 3000, localHost: 'localhost' }],
      });
      expect(() => config.validate()).toThrow('认证令牌是必需的');
    });

    it('should throw error when serverUrl does not start with ws:// or wss://', () => {
      const config = new Config({
        serverUrl: 'http://localhost:9000',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 8080, localPort: 3000, localHost: 'localhost' }],
      });
      expect(() => config.validate()).toThrow('必须以 ws:// 或 wss:// 开头');
    });

    it('should throw error when proxies array is empty', () => {
      const config = new Config({
        serverUrl: 'ws://localhost:9000',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [],
      });
      expect(() => config.validate()).toThrow('至少需要一个代理配置');
    });

    it('should throw error when remotePort is invalid', () => {
      const config = new Config({
        serverUrl: 'ws://localhost:9000',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 100, localPort: 3000, localHost: 'localhost' }],
      });
      expect(() => config.validate()).toThrow('remotePort 无效');
    });

    it('should throw error when localPort is invalid', () => {
      const config = new Config({
        serverUrl: 'ws://localhost:9000',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 8080, localPort: 0, localHost: 'localhost' }],
      });
      expect(() => config.validate()).toThrow('localPort 无效');
    });

    it('should accept wss:// protocol', () => {
      const config = new Config({
        serverUrl: 'wss://localhost:9000',
        token: 'test-token',
        reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
        maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
        proxies: [{ remotePort: 8080, localPort: 3000, localHost: 'localhost' }],
      });
      expect(() => config.validate()).not.toThrow();
    });
  });
});
