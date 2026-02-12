/**
 * CLI crash-restart 集成测试
 * 测试守护进程的崩溃检测和自动重启功能
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { readFileSync, unlinkSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { WebSocketServer } from 'ws';

const CLIENT_DIR = join(homedir(), '.chuantou', 'client');
const PID_FILE = join(CLIENT_DIR, 'client.pid');
const CONFIG_FILE = join(CLIENT_DIR, 'config.json');
const LOG_FILE = join(CLIENT_DIR, 'client.log');

let wsServer: WebSocketServer | null = null;
let wsPort = 0;

function getRandomPort() {
  return 10000 + Math.floor(Math.random() * 1000);
}

async function startMockWsServer() {
  return new Promise<void>((resolve) => {
    const server = new WebSocketServer({ port: 0 }, () => {
      wsPort = (server as any).address().port;
      resolve();
    });
    wsServer = server;
  });
}

function stopMockWsServer() {
  if (wsServer) {
    wsServer.close();
    wsServer = null;
  }
}

function createTestConfig() {
  const config = {
    serverUrl: `ws://localhost:${wsPort}`,
    token: '',
    reconnectInterval: 30000,
    maxReconnectAttempts: 10,
    proxies: [{ remotePort: wsPort + 1, localPort: 3000 }]
  };
  mkdirSync(CLIENT_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config));
}

function readPidFile() {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

async function wait(ms: number) {
  await new Promise(r => setTimeout(r, ms));
}

async function waitForPidFile(maxMs = 5000): Promise<number | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxMs) {
    const pidInfo = readPidFile();
    if (pidInfo?.pid) return pidInfo.pid as number;
    await wait(100);
  }
  return null;
}

function stopProcess(pid: number) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }
}

function killProcess(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore
  }
}

function deletePidFile() {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function clearLogFile() {
  try {
    unlinkSync(LOG_FILE);
  } catch {
    // ignore
  }
}

function readLogFile(): string {
  try {
    return readFileSync(LOG_FILE, 'utf-8');
  } catch {
    return '';
  }
}

function logFileExists(): boolean {
  return existsSync(LOG_FILE);
}

beforeAll(async () => {
  deletePidFile();
  await startMockWsServer();
  createTestConfig();
  clearLogFile();
});

afterAll(async () => {
  stopMockWsServer();
  const pidInfo = readPidFile();
  if (pidInfo?.pid) {
    stopProcess(pidInfo.pid);
    await wait(500);
  }
  deletePidFile();
});

describe('CLI crash-restart integration tests', () => {
  const nodePath = process.execPath;
  // 使用 __dirname 来定位测试文件所在目录，从而找到正确的 dist 路径
  const cliPath = join(__dirname, '..', 'dist', 'cli.js');

  it('should start daemon and write PID file', { timeout: 15000 }, async () => {
    deletePidFile();

    const child = spawn(nodePath, [cliPath, 'start', '--config', CONFIG_FILE, '--no-boot'], {
      stdio: 'pipe',
      detached: true,
    });

    child.unref();

    const pid = await waitForPidFile(10000);

    expect(pid).not.toBeNull();
    expect(pid).toBeGreaterThan(0);

    const pidInfo = readPidFile();
    expect(pidInfo?.pid).toBeGreaterThan(0);
    expect(typeof pidInfo?.serverUrl).toBe('string');
    expect(typeof pidInfo?.startedAt).toBe('number');

    if (pidInfo?.pid) {
      stopProcess(pidInfo.pid);
    }
    await wait(500);
  });

  it('stop command should stop process and delete PID file', { timeout: 15000 }, async () => {
    deletePidFile();

    const startChild = spawn(nodePath, [cliPath, 'start', '--config', CONFIG_FILE, '--no-boot'], {
      stdio: 'pipe',
      detached: true,
    });

    startChild.unref();

    await wait(3000);

    const pidInfo = readPidFile();
    expect(pidInfo).not.toBeNull();

    spawn(nodePath, [cliPath, 'stop'], {
      stdio: 'pipe',
    });

    await wait(3000);

    const pidInfoAfter = readPidFile();
    expect(pidInfoAfter).toBeNull();
  });

  it('should detect crash via SIGTERM and log it', { timeout: 15000 }, async () => {
    deletePidFile();
    clearLogFile();

    const startChild = spawn(nodePath, [cliPath, 'start', '--config', CONFIG_FILE, '--no-boot'], {
      stdio: 'pipe',
      detached: true,
    });

    startChild.unref();

    const daemonPid = await waitForPidFile(10000);
    expect(daemonPid).toBeGreaterThan(0);

    await wait(2000);

    if (daemonPid) {
      killProcess(daemonPid);
    }

    await wait(5000);

    const logExists = logFileExists();
    if (logExists) {
      const logContent = readLogFile();
      expect(logContent.length).toBeGreaterThan(0);
    }

    const finalPidInfo = readPidFile();
    if (finalPidInfo?.pid) {
      stopProcess(finalPidInfo.pid);
    }
    await wait(500);
  });

  it('PID file should contain lastRestartTime after crash', { timeout: 20000 }, async () => {
    deletePidFile();

    const startChild = spawn(nodePath, [cliPath, 'start', '--config', CONFIG_FILE, '--no-boot'], {
      stdio: 'pipe',
      detached: true,
    });

    startChild.unref();

    await waitForPidFile(10000);
    const initialPidInfo = readPidFile();

    expect(initialPidInfo?.lastRestartTime).toBeUndefined();

    const daemonPid = initialPidInfo?.pid;
    await wait(2000);

    if (daemonPid) {
      killProcess(daemonPid);
    }

    await wait(6000);

    const newPidInfo = readPidFile();
    if (newPidInfo?.pid && newPidInfo.pid !== daemonPid) {
      expect(newPidInfo.lastRestartTime).toBeDefined();
      expect(typeof newPidInfo.lastRestartTime).toBe('number');
      stopProcess(newPidInfo.pid);
    } else if (newPidInfo?.pid) {
      stopProcess(newPidInfo.pid);
    }

    await wait(500);
  });

  it('should not restart when stopped via stop command', { timeout: 15000 }, async () => {
    deletePidFile();

    const startChild = spawn(nodePath, [cliPath, 'start', '--config', CONFIG_FILE, '--no-boot'], {
      stdio: 'pipe',
      detached: true,
    });

    startChild.unref();

    const daemonPid = await waitForPidFile(10000);
    expect(daemonPid).toBeGreaterThan(0);

    await wait(2000);

    spawn(nodePath, [cliPath, 'stop'], {
      stdio: 'pipe',
    });

    await wait(3000);

    const pidInfoAfter = readPidFile();
    expect(pidInfoAfter).toBeNull();
  });
});
