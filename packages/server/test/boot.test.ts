/**
 * boot 模块单元测试
 * 测试开机自启动的注册、注销和状态查询（使用 mock 避免真实系统调用）
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, unlinkSync, existsSync, rmdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import * as os from 'os';

// mock os 模块
const testHomeDirs = new Map<string, string>();

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => {
      // 从 Map 获取当前测试的 home dir
      const currentTestDir = testHomeDirs.get('current');
      return currentTestDir ?? actual.homedir();
    },
  };
});

// mock child_process.execSync 避免真实系统调用
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

const { execSync } = await import('child_process');
const mockExecSync = vi.mocked(execSync);

// 为了避免模块缓存问题，每个测试套件使用不同的 home dir
const serverHomeDir = join(os.tmpdir(), `chuantou-test-server-${randomUUID()}`);
const clientHomeDir = join(os.tmpdir(), `chuantou-test-client-${randomUUID()}`);

describe('boot 模块', () => {
  const testServerStartupInfo = {
    isServer: true,
    nodePath: '/usr/bin/node',
    scriptPath: '/path/to/cli.js',
    args: ['--port', '9000', '--host', '0.0.0.0'],
  };

  const testClientStartupInfo = {
    isServer: false,
    nodePath: '/usr/bin/node',
    scriptPath: '/path/to/cli.js',
    args: ['--server', 'ws://localhost:9000', '--token', 'test'],
  };

  // 清理函数
  function cleanupTestDir(homeDir: string) {
    try {
      unlinkSync(join(homeDir, '.chuantou', 'server', 'boot.json'));
    } catch { /* ignore */ }
    try {
      unlinkSync(join(homeDir, '.chuantou', 'client', 'boot.json'));
    } catch { /* ignore */ }
    try {
      unlinkSync(join(homeDir, '.chuantou', 'server', 'feng3d-cts.vbs'));
    } catch { /* ignore */ }
    try {
      unlinkSync(join(homeDir, '.chuantou', 'client', 'feng3d-ctc.vbs'));
    } catch { /* ignore */ }
    try {
      rmdirSync(join(homeDir, '.chuantou', 'server'));
    } catch { /* ignore */ }
    try {
      rmdirSync(join(homeDir, '.chuantou', 'client'));
    } catch { /* ignore */ }
    try {
      rmdirSync(join(homeDir, '.chuantou'));
    } catch { /* ignore */ }
  }

  // 所有测试后清理
  afterAll(() => {
    cleanupTestDir(serverHomeDir);
    cleanupTestDir(clientHomeDir);
  });

  describe('服务端启动配置', () => {
    let bootModule: any;

    beforeAll(async () => {
      vi.clearAllMocks();
      testHomeDirs.set('current', serverHomeDir);
      mkdirSync(join(serverHomeDir, '.chuantou'), { recursive: true });
      mockExecSync.mockImplementation(() => Buffer.from(''));
      bootModule = await import('@feng3d/chuantou-shared');
    });

    afterAll(() => {
      testHomeDirs.delete('current');
      vi.restoreAllMocks();
    });

    it('registerBoot 应该保存服务端启动信息到 server/boot.json', async () => {
      bootModule.registerBoot(testServerStartupInfo);
      const bootPath = join(serverHomeDir, '.chuantou', 'server', 'boot.json');
      expect(existsSync(bootPath)).toBe(true);
      const saved = JSON.parse(readFileSync(bootPath, 'utf-8'));
      expect(saved).toEqual(testServerStartupInfo);
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('reg add'),
        expect.objectContaining({ shell: 'cmd.exe' }),
      );
    });

    it('服务端 VBS 脚本应放在 server 目录', async () => {
      bootModule.registerBoot(testServerStartupInfo);
      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const vbsCall = calls.find((c) => c.includes('feng3d-cts.vbs'));
      expect(vbsCall).toBeDefined();
      expect(vbsCall).toContain('server');
    });

    it('unregisterBoot 应该删除服务端 boot.json', async () => {
      // 先写入配置文件
      bootModule.registerBoot(testServerStartupInfo);
      const bootPath = join(serverHomeDir, '.chuantou', 'server', 'boot.json');
      expect(existsSync(bootPath)).toBe(true);

      bootModule.unregisterBoot();

      // 验证文件已被删除
      expect(existsSync(bootPath)).toBe(false);
    });

    it('isBootRegistered 应检测服务端启动状态', async () => {
      cleanupTestDir(serverHomeDir);
      expect(bootModule.isBootRegistered()).toBe(false);
      bootModule.registerBoot(testServerStartupInfo);
      expect(bootModule.isBootRegistered()).toBe(true);
      // 清除服务端配置
      bootModule.unregisterBoot();
      expect(bootModule.isBootRegistered()).toBe(false);
    });
  });

  describe('客户端启动配置', () => {
    let bootModule: any;

    beforeAll(async () => {
      vi.clearAllMocks();
      testHomeDirs.set('current', clientHomeDir);
      mkdirSync(join(clientHomeDir, '.chuantou'), { recursive: true });
      mockExecSync.mockImplementation(() => Buffer.from(''));
      // 使用 vi.isolateModules 来重新导入模块
      vi.unmock('@feng3d/chuantou-shared');
      vi.resetModules();
      bootModule = await import('@feng3d/chuantou-shared');
    });

    afterAll(() => {
      testHomeDirs.delete('current');
    });

    it('registerBoot 应该保存客户端启动信息到 client/boot.json', async () => {
      bootModule.registerBoot(testClientStartupInfo);
      const bootPath = join(clientHomeDir, '.chuantou', 'client', 'boot.json');
      expect(existsSync(bootPath)).toBe(true);
      const saved = JSON.parse(readFileSync(bootPath, 'utf-8'));
      expect(saved).toEqual(testClientStartupInfo);
    });

    it('客户端 VBS 脚本应放在 client 目录', async () => {
      bootModule.registerBoot(testClientStartupInfo);
      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const vbsCall = calls.find((c) => c.includes('feng3d-ctc.vbs'));
      expect(vbsCall).toBeDefined();
      expect(vbsCall).toContain('client');
    });

    it('unregisterBoot 应该删除客户端 boot.json', async () => {
      // 先写入配置文件
      bootModule.registerBoot(testClientStartupInfo);
      const bootPath = join(clientHomeDir, '.chuantou', 'client', 'boot.json');
      expect(existsSync(bootPath)).toBe(true);

      bootModule.unregisterBoot();

      // 验证文件已被删除
      expect(existsSync(bootPath)).toBe(false);
    });
  });

  describe('状态查询（混合模式）', () => {
    let bootModule: any;
    const mixedHomeDir = join(os.tmpdir(), `chuantou-test-mixed-${randomUUID()}`);

    beforeAll(async () => {
      vi.clearAllMocks();
      testHomeDirs.set('current', mixedHomeDir);
      mkdirSync(join(mixedHomeDir, '.chuantou'), { recursive: true });
      mockExecSync.mockImplementation(() => Buffer.from(''));
      vi.resetModules();
      bootModule = await import('@feng3d/chuantou-shared');
    });

    afterAll(() => {
      testHomeDirs.delete('current');
      cleanupTestDir(mixedHomeDir);
    });

    it('loadStartupInfo 应优先读取服务端配置', async () => {
      // 只写入服务端配置
      bootModule.registerBoot(testServerStartupInfo);
      const loaded = bootModule.loadStartupInfo();
      expect(loaded).toEqual(testServerStartupInfo);
    });

    it('当服务端配置不存在时应返回客户端配置', async () => {
      // 清理之前的数据
      cleanupTestDir(mixedHomeDir);
      mkdirSync(join(mixedHomeDir, '.chuantou'), { recursive: true });

      // 只写入客户端配置
      bootModule.registerBoot(testClientStartupInfo);
      const loaded = bootModule.loadStartupInfo();
      expect(loaded).toEqual(testClientStartupInfo);
    });

    it('isBootRegistered 应根据 loadStartupInfo 自动识别', async () => {
      // 清理之前的数据
      cleanupTestDir(mixedHomeDir);
      mkdirSync(join(mixedHomeDir, '.chuantou'), { recursive: true });

      expect(bootModule.isBootRegistered()).toBe(false);
      bootModule.registerBoot(testServerStartupInfo);
      expect(bootModule.isBootRegistered()).toBe(true);
      // 清除服务端配置
      bootModule.unregisterBoot();
      expect(bootModule.isBootRegistered()).toBe(false);
    });
  });
});
