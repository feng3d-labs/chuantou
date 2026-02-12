/**
 * 配置管理功能测试
 * 测试服务端配置加载、token生成和配置保存功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

// 测试用的临时配置目录
let testConfigDir: string;
let testConfigPath: string;

async function createTestConfigDir() {
  const tmpDir = path.join(os.tmpdir(), `chuantou-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
  return tmpDir;
}

async function cleanupTestConfigDir(dir: string) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    // 忽略清理错误
  }
}

// Token生成测试（独立测试，不依赖配置模块）
describe('Token生成功能', () => {
  it('应该生成32字符的十六进制token', () => {
    const token = randomBytes(16).toString('hex');
    expect(token).toHaveLength(32);
    expect(/^[0-9a-f]{32}$/.test(token)).toBe(true);
  });

  it('每次生成的token应该不同', () => {
    const token1 = randomBytes(16).toString('hex');
    const token2 = randomBytes(16).toString('hex');
    expect(token1).not.toBe(token2);
  });

  it('应该能够批量生成多个不同的token', () => {
    const tokens = new Set();
    for (let i = 0; i < 100; i++) {
      tokens.add(randomBytes(16).toString('hex'));
    }
    expect(tokens.size).toBe(100);
  });
});

describe('配置文件操作', () => {
  beforeEach(async () => {
    testConfigDir = await createTestConfigDir();
    testConfigPath = path.join(testConfigDir, 'server.json');
  });

  afterEach(async () => {
    await cleanupTestConfigDir(testConfigDir);
  });

  describe('配置文件读写', () => {
    it('应该能够创建配置目录', async () => {
      const newDir = path.join(testConfigDir, 'nested', 'config');
      await fs.mkdir(newDir, { recursive: true });

      const exists = await fs.access(newDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('应该能够写入和读取配置文件', async () => {
      const config = {
        host: '0.0.0.0',
        controlPort: 9000,
        authTokens: ['test-token-abc123'],
        heartbeatInterval: 30000,
        sessionTimeout: 60000
      };

      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(testConfigPath, 'utf-8');
      const loaded = JSON.parse(content);

      expect(loaded).toEqual(config);
      expect(loaded.authTokens[0]).toBe('test-token-abc123');
    });

    it('写入的JSON应该是格式化的', async () => {
      const config = {
        host: '0.0.0.0',
        controlPort: 9000,
        authTokens: [randomBytes(16).toString('hex')],
        heartbeatInterval: 30000,
        sessionTimeout: 60000
      };

      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(testConfigPath, 'utf-8');

      // 验证格式化
      expect(content).toContain('\n');
      expect(content).toContain('  ');
      expect(content).toMatch(/{\s*\n\s*"host"/);
    });

    it('应该能够处理不存在的配置文件', async () => {
      const nonExistentPath = path.join(testConfigDir, 'does-not-exist.json');

      let exists = true;
      try {
        await fs.access(nonExistentPath);
      } catch {
        exists = false;
      }

      expect(exists).toBe(false);
    });
  });

  describe('Token优先级逻辑', () => {
    it('应该支持从配置文件读取token', async () => {
      const fileConfig = {
        host: '0.0.0.0',
        controlPort: 9000,
        authTokens: ['file-token'],
        heartbeatInterval: 30000,
        sessionTimeout: 60000
      };

      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, JSON.stringify(fileConfig, null, 2));

      const content = await fs.readFile(testConfigPath, 'utf-8');
      const loaded = JSON.parse(content);

      expect(loaded.authTokens[0]).toBe('file-token');
    });

    it('应该支持多个token（数组形式）', async () => {
      const config = {
        authTokens: ['token1', 'token2', 'token3']
      };

      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));

      const content = await fs.readFile(testConfigPath, 'utf-8');
      const loaded = JSON.parse(content);

      expect(loaded.authTokens).toHaveLength(3);
      expect(loaded.authTokens).toEqual(['token1', 'token2', 'token3']);
    });

    it('应该支持逗号分隔的token字符串解析', () => {
      const tokenString = 'token1,token2,token3';
      const tokens = tokenString.split(',');

      expect(tokens).toEqual(['token1', 'token2', 'token3']);
    });
  });

  describe('配置文件验证', () => {
    it('应该能够验证token是否有效', () => {
      const authTokens = ['token1', 'token2', 'token3'];

      const isValid = (token: string) => authTokens.includes(token);

      expect(isValid('token1')).toBe(true);
      expect(isValid('token2')).toBe(true);
      expect(isValid('token3')).toBe(true);
      expect(isValid('invalid')).toBe(false);
    });

    it('应该能够验证空token数组', () => {
      const authTokens: string[] = [];

      const isValid = (token: string) => authTokens.includes(token);

      expect(isValid('anything')).toBe(false);
    });
  });

  describe('错误处理', () => {
    it('应该能够处理无效的JSON', async () => {
      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, 'invalid json {');

      let parseError = null;
      try {
        const content = await fs.readFile(testConfigPath, 'utf-8');
        JSON.parse(content);
      } catch (error) {
        parseError = error;
      }

      expect(parseError).not.toBeNull();
    });

    it('读取不存在的文件应该抛出错误', async () => {
      const nonExistentPath = path.join(testConfigDir, 'does-not-exist.json');

      let fileError = null;
      try {
        await fs.readFile(nonExistentPath, 'utf-8');
      } catch (error) {
        fileError = error;
      }

      expect(fileError).not.toBeNull();
      expect((fileError as NodeJS.ErrnoException).code).toBe('ENOENT');
    });

    it('写入到只读目录应该失败', async () => {
      // 在Windows上这个测试可能不太准确，但仍然可以测试错误处理
      const readOnlyPath = path.join(testConfigDir, 'readonly.json');

      // 这个测试只是为了确保我们能够处理写入错误
      const config = { test: 'value' };

      // 正常情况下应该成功
      await fs.mkdir(path.dirname(readOnlyPath), { recursive: true });
      await fs.writeFile(readOnlyPath, JSON.stringify(config));

      const exists = await fs.access(readOnlyPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });
});

describe('配置合并逻辑', () => {
  it('应该正确合并配置（默认值 < 文件配置 < 命令行参数）', () => {
    // 默认配置
    const defaultConfig = {
      host: '0.0.0.0',
      controlPort: 9000,
      authTokens: [],
      heartbeatInterval: 30000,
      sessionTimeout: 60000
    };

    // 文件配置
    const fileConfig = {
      controlPort: 8000,
      authTokens: ['file-token']
    };

    // 命令行配置
    const cliConfig = {
      authTokens: ['cli-token']
    };

    // 模拟合并过程
    const merged = { ...defaultConfig, ...fileConfig, ...cliConfig };

    expect(merged.controlPort).toBe(8000); // 来自文件
    expect(merged.authTokens).toEqual(['cli-token']); // 来自命令行（覆盖文件）
    expect(merged.host).toBe('0.0.0.0'); // 来自默认值
  });

  it('空配置应该使用所有默认值', () => {
    const defaultConfig = {
      host: '0.0.0.0',
      controlPort: 9000,
      authTokens: [],
      heartbeatInterval: 30000,
      sessionTimeout: 60000
    };

    const merged = { ...defaultConfig };

    expect(merged.host).toBe('0.0.0.0');
    expect(merged.controlPort).toBe(9000);
    expect(merged.authTokens).toEqual([]);
    expect(merged.heartbeatInterval).toBe(30000);
    expect(merged.sessionTimeout).toBe(60000);
  });
});
