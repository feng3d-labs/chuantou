/**
 * boot 模块单元测试
 * 测试开机自启动的注册、注销和状态查询（使用 mock 避免真实系统调用）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// mock child_process.execSync 避免真实系统调用
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// mock os.homedir 使用临时目录
const testHomeDir = join(tmpdir(), `chuantou-test-${randomUUID()}`);
vi.mock('os', async (importOriginal) => {
  const original = await importOriginal<typeof import('os')>();
  return {
    ...original,
    homedir: () => testHomeDir,
  };
});

import { execSync } from 'child_process';
import { registerBoot, unregisterBoot, isBootRegistered, type StartupInfo } from '@feng3d/chuantou-shared';

const mockExecSync = vi.mocked(execSync);

const testServerStartupInfo: StartupInfo = {
  isServer: true,
  nodePath: '/usr/bin/node',
  scriptPath: '/path/to/cli.js',
  args: ['--port', '9000', '--host', '0.0.0.0'],
};

const testClientStartupInfo: StartupInfo = {
  isServer: false,
  nodePath: '/usr/bin/node',
  scriptPath: '/path/to/cli.js',
  args: ['--server', 'ws://localhost:9000', '--token', 'test'],
};

describe('boot 模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 创建测试目录
    mkdirSync(join(testHomeDir, '.chuantou'), { recursive: true });
  });

  afterEach(() => {
    // 清理测试目录
    try {
      unlinkSync(join(testHomeDir, '.chuantou', 'server', 'boot.json'));
      unlinkSync(join(testHomeDir, '.chuantou', 'client', 'boot.json'));
    } catch {
      // ignore
    }
  });

  describe('服务端启动配置', () => {
    it('registerBoot 应该保存服务端启动信息到 server/boot.json', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      boot.registerBoot(testServerStartupInfo);

      const saved = JSON.parse(
        readFileSync(join(testHomeDir, '.chuantou', 'server', 'boot.json'), 'utf-8'),
      );

      expect(saved).toEqual(testServerStartupInfo);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('reg add'),
      );
    });

    it('服务端 VBS 脚本应放在 server 目录', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      boot.registerBoot(testServerStartupInfo);

      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const vbsCall = calls.find((c) => c.includes('feng3d-cts.vbs'));

      expect(vbsCall).toBeDefined();
      expect(vbsCall).toContain('server');
    });

    it('unregisterBoot 应该删除服务端 boot.json', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      // 先写入配置文件
      boot.registerBoot(testServerStartupInfo);

      boot.unregisterBoot();

      // 验证文件已被删除
      const exists = () => {
        try {
          readFileSync(join(testHomeDir, '.chuantou', 'server', 'boot.json'), 'utf-8');
          return true;
        } catch {
          return false;
        }
      };

      expect(exists()).toBe(false);
    });

    it('isBootRegistered 应检测服务端启动状态', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      expect(boot.isBootRegistered()).toBe(false);

      boot.registerBoot(testServerStartupInfo);

      expect(boot.isBootRegistered()).toBe(true);
    });
  });

  describe('客户端启动配置', () => {
    it('registerBoot 应该保存客户端启动信息到 client/boot.json', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      boot.registerBoot(testClientStartupInfo);

      const saved = JSON.parse(
        readFileSync(join(testHomeDir, '.chuantou', 'client', 'boot.json'), 'utf-8'),
      );

      expect(saved).toEqual(testClientStartupInfo);
    });

    it('客户端 VBS 脚本应放在 client 目录', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      boot.registerBoot(testClientStartupInfo);

      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const vbsCall = calls.find((c) => c.includes('feng3d-ctc.vbs'));

      expect(vbsCall).toBeDefined();
      expect(vbsCall).toContain('client');
    });

    it('unregisterBoot 应该删除客户端 boot.json', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      // 先写入配置文件
      boot.registerBoot(testClientStartupInfo);

      boot.unregisterBoot();

      // 验证文件已被删除
      const exists = () => {
        try {
          readFileSync(join(testHomeDir, '.chuantou', 'client', 'boot.json'), 'utf-8');
          return true;
        } catch {
          return false;
        }
      };

      expect(exists()).toBe(false);
    });
  });

  describe('状态查询（混合模式）', () => {
    it('loadStartupInfo 应优先读取服务端配置', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      // 只写入服务端配置
      boot.registerBoot(testServerStartupInfo);

      const loaded = boot.loadStartupInfo();

      expect(loaded).toEqual(testServerStartupInfo);
    });

    it('当服务端配置不存在时应返回客户端配置', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      // 只写入客户端配置
      boot.registerBoot(testClientStartupInfo);

      const loaded = boot.loadStartupInfo();

      expect(loaded).toEqual(testClientStartupInfo);
    });

    it('isBootRegistered 应根据 loadStartupInfo 自动识别', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      expect(boot.isBootRegistered()).toBe(false);

      // 注册服务端
      boot.registerBoot(testServerStartupInfo);

      expect(boot.isBootRegistered()).toBe(true);

      // 清除服务端配置
      boot.unregisterBoot(true);

      // 应该自动切换到检测客户端配置
      expect(boot.isBootRegistered()).toBe(false);
    });
  });
});
