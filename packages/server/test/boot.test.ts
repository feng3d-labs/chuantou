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
import { registerBoot, unregisterBoot, isBootRegistered, type StartupInfo } from '../src/boot.js';

const mockExecSync = vi.mocked(execSync);

const testStartupInfo: StartupInfo = {
  nodePath: '/usr/bin/node',
  scriptPath: '/path/to/cli.js',
  args: ['--port', '9000', '--host', '0.0.0.0', '--tokens', 'test-token'],
};

describe('boot 模块', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 创建测试目录
    mkdirSync(join(testHomeDir, '.chuantou'), { recursive: true });
  });

  afterEach(() => {
    // 清理测试文件
    try {
      unlinkSync(join(testHomeDir, '.chuantou', 'startup.json'));
    } catch {
      // ignore
    }
  });

  describe('Windows (win32)', () => {
    beforeEach(() => {
      vi.stubGlobal('process', { ...process, platform: 'win32' });
      // 动态 mock platform()
      vi.mock('os', async (importOriginal) => {
        const original = await importOriginal<typeof import('os')>();
        return {
          ...original,
          homedir: () => testHomeDir,
          platform: () => 'win32',
        };
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('registerBoot 应该保存启动信息到文件', async () => {
      // 重新导入以获取最新的 mock
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      boot.registerBoot(testStartupInfo);

      const saved = JSON.parse(
        readFileSync(join(testHomeDir, '.chuantou', 'startup.json'), 'utf-8'),
      );
      expect(saved.nodePath).toBe('/usr/bin/node');
      expect(saved.scriptPath).toBe('/path/to/cli.js');
      expect(saved.args).toEqual(testStartupInfo.args);
    });

    it('registerBoot 应该调用 schtasks /create', async () => {
      const boot = await import('../src/boot.js');

      mockExecSync.mockImplementation(() => Buffer.from(''));

      boot.registerBoot(testStartupInfo);

      // 应该有两次调用：先 delete（忽略错误），再 create
      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const createCall = calls.find((c) => c.includes('/create'));
      expect(createCall).toBeDefined();
      expect(createCall).toContain('schtasks');
      expect(createCall).toContain('feng3d-cts');
      expect(createCall).toContain('ONLOGON');
    });
  });

  describe('启动信息持久化', () => {
    it('应该能保存和读取启动信息', () => {
      const filePath = join(testHomeDir, '.chuantou', 'startup.json');
      writeFileSync(filePath, JSON.stringify(testStartupInfo, null, 2));

      const content = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(content.nodePath).toBe(testStartupInfo.nodePath);
      expect(content.scriptPath).toBe(testStartupInfo.scriptPath);
      expect(content.args).toEqual(testStartupInfo.args);
    });
  });
});
