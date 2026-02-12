#!/usr/bin/env node

/**
 * @module cli
 * @description 穿透客户端命令行工具模块。
 * 提供 `feng3d-ctc` CLI 命令，支持启动、停止和查询客户端状态。
 * 单实例模式：只允许一个客户端实例运行，多次 start 会向已运行进程添加端口映射。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync, closeSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import { MessageType, createMessage, ProxyConfig } from '@feng3d/chuantou-shared';

/** 客户端实例数据目录 */
const DATA_DIR = join(homedir(), '.chuantou');
/** PID 文件路径 */
const PID_FILE = join(DATA_DIR, 'client.pid');
/** 添加代理请求目录 */
const REQUEST_DIR = join(DATA_DIR, 'proxy-requests');
/** 添加代理请求文件路径 */
const ADD_PROXY_REQUEST_FILE = join(DATA_DIR, 'add-proxy-request.json');
/** 客户端信息接口 */
interface ClientInfo {
  /** 服务器地址 */
  serverUrl: string;
  /** 进程 ID */
  pid: number;
  /** 启动时间 */
  startedAt: number;
}
/** 添加代理请求接口 */
interface AddProxyRequest {
  /** 代理配置 */
  proxy: ProxyConfig;
  /** 请求 ID */
  id: string;
}

/**
 * 写入 PID 文件
 */
function writePidFile(info: ClientInfo): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

/**
 * 读取 PID 文件
 */
function readPidFile(): ClientInfo | null {
  try {
    const content = readFileSync(PID_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 删除 PID 文件
 */
function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

/**
 * 检查客户端是否正在运行
 */
function isClientRunning(): boolean {
  const info = readPidFile();
  if (!info) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    // 进程不存在，清理 PID 文件
    removePidFile();
    return false;
  }
}

/**
 * 在浏览器中打开 URL
 */
function openBrowser(url: string): void {
  const os = platform();
  try {
    if (os === 'win32') {
      execSync(`cmd.exe /c start "" "${url}"`, { stdio: 'ignore' });
    } else if (os === 'darwin') {
      execSync(`open "${url}"`, { stdio: 'ignore' });
    } else {
      // Linux
      execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    }
  } catch {
    // 忽略错误，浏览器打开失败不影响服务
  }
}

/** 通用服务器选项 */
const serverOptions = [
  ['-s, --server <url>', '服务器地址 (如 ws://localhost:9000)', 'ws://localhost:9000'],
  ['-t, --token <token>', '认证令牌'],
  ['-p, --proxies <proxies>', '代理配置 (格式: remotePort:localPort:localHost 或 remotePort:localPort:localHost:protocol，protocol 可选为 http 或 tcp，默认为 http)'],
  ['--reconnect-interval <ms>', '重连间隔（毫秒）', '5000'],
  ['--max-reconnect <number>', '最大重连次数', '10'],
] as const;

const program = new Command();

program
  .name('feng3d-ctc')
  .description(chalk.blue('穿透 - 内网穿透客户端'))
  .version('0.0.5');

// ====== start 命令 ======

const startCmd = program.command('start').description('启动客户端（后台运行）');
for (const opt of serverOptions) {
  if (opt.length === 3) {
    startCmd.option(opt[0], opt[1], opt[2]);
  } else {
    startCmd.option(opt[0], opt[1]);
  }
}
startCmd.option('--no-daemon', '前台运行（不作为后台守护进程）');
startCmd.option('-o, --open', '启动后在浏览器中打开管理页面');
startCmd.action(async (options) => {
  const serverUrl = options.server;
  const token = options.token;
  const proxiesStr = options.proxies;
  const shouldOpenBrowser = options.open as boolean;

  // 解析代理配置
  const proxies: ProxyConfig[] = [];
  if (proxiesStr) {
    for (const p of proxiesStr.split(',')) {
      const parts = p.trim().split(':');
      const remotePort = parseInt(parts[0], 10);
      const localPort = parseInt(parts[1], 10);

      // 处理协议参数：格式为 remotePort:localPort:localHost:protocol
      // 或 remotePort:localPort::protocol (跳过 localHost)
      let localHost = 'localhost';
      let protocol: 'http' | 'tcp' | undefined = undefined;

      if (parts.length >= 4 && parts[3]) {
        // 如果第4部分存在且非空，检查是否为协议类型
        if (parts[3] === 'http' || parts[3] === 'tcp') {
          protocol = parts[3];
          // 第3部分可能是空字符串或实际的 localHost
          if (parts[2] && parts[2] !== '') {
            localHost = parts[2];
          }
        } else if (parts[2] === 'http' || parts[2] === 'tcp') {
          // 第3部分是协议类型，第4部分是其他内容（忽略）
          protocol = parts[2] as 'http' | 'tcp';
          if (parts[2] !== '' && parts[2] !== 'http' && parts[2] !== 'tcp') {
            localHost = parts[2];
          }
        } else if (parts[2]) {
          // 第3部分不是协议类型，当作 localHost
          localHost = parts[2];
        }
      } else if (parts.length >= 3 && parts[2]) {
        // 检查第3部分是否为协议类型
        if (parts[2] === 'http' || parts[2] === 'tcp') {
          protocol = parts[2] as 'http' | 'tcp';
        } else {
          // 否则当作 localHost
          localHost = parts[2];
        }
      }

      const config: any = {
        remotePort,
        localPort,
        localHost,
      };
      // 只有在明确指定协议时才添加 protocol 字段
      if (protocol !== undefined) {
        config.protocol = protocol;
      }
      proxies.push(config);
    }
  }

  // 检查客户端是否已运行
  if (isClientRunning()) {
    const info = readPidFile()!;

    // 检查服务器地址是否一致
    if (info.serverUrl !== serverUrl) {
      console.log(chalk.yellow('客户端正在运行，但连接到不同的服务器'));
      console.log(chalk.gray(`  当前: ${info.serverUrl}`));
      console.log(chalk.gray(`  新请求: ${serverUrl}`));
      console.log(chalk.yellow('请先停止当前客户端，或使用相同的服务器地址'));
      process.exit(1);
    }

    // 客户端已运行，添加代理映射
    console.log(chalk.green('客户端正在运行，添加新的代理映射...'));

    for (const proxy of proxies) {
      await addProxyToRunningClient(info.serverUrl, token, proxy);
    }

    return;
  }

  // 构建 _serve 参数
  const serveArgs: string[] = [];
  serveArgs.push('--server', serverUrl);
  if (token) serveArgs.push('--token', token);
  if (proxiesStr) serveArgs.push('--proxies', proxiesStr);
  serveArgs.push('--reconnect-interval', options.reconnectInterval);
  serveArgs.push('--max-reconnect', options.maxReconnect);

  // 是否后台运行
  const daemon = options.daemon !== false;

  if (daemon) {
    // 后台守护进程模式
    const scriptPath = fileURLToPath(import.meta.url);
    const nodePath = process.execPath;
    const logPath = join(DATA_DIR, 'client.log');

    // 打开日志文件
    const logFd = openSync(logPath, 'a');

    // 启动后台守护进程
    const child = spawn(nodePath, [scriptPath, '_serve', ...serveArgs], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });

    child.unref();
    closeSync(logFd);

    // 等待一小段时间让进程启动
    await new Promise((r) => setTimeout(r, 500));

    // 验证进程是否启动成功
    const pid = child.pid;
    if (pid === undefined) {
      console.log(chalk.red('客户端启动失败，请查看日志文件:'));
      console.log(chalk.gray(`  ${logPath}`));
      process.exit(1);
    }

    try {
      process.kill(pid, 0);
    } catch {
      console.log(chalk.red('客户端启动失败，请查看日志文件:'));
      console.log(chalk.gray(`  ${logPath}`));
      process.exit(1);
    }

    // 写入 PID 文件
    writePidFile({
      serverUrl,
      pid,
      startedAt: Date.now(),
    });

    console.log(chalk.green('客户端已在后台启动'));
    console.log(chalk.gray(`  PID: ${pid}`));
    console.log(chalk.gray(`  服务器: ${serverUrl}`));
    console.log(chalk.gray(`  日志: ${logPath}`));

    if (proxies.length > 0) {
      console.log(chalk.gray(`  代理映射:`));
      for (const proxy of proxies) {
        const protocol = proxy.protocol || 'http';
        console.log(chalk.gray(`    :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort} (${protocol})`));
      }
    }

    // 打开浏览器
    if (shouldOpenBrowser) {
      setTimeout(() => {
        openBrowser('http://127.0.0.1:9001/');
      }, 2000);
    }
  } else {
    // 前台运行模式
    await runServe(serverUrl, token, proxiesStr, options.reconnectInterval, options.maxReconnect, shouldOpenBrowser);
  }
});

// ====== _serve 命令（隐藏，前台运行）======

const serveCmd = program.command('_serve', { hidden: true }).description('前台运行客户端（内部命令）');
for (const opt of serverOptions) {
  if (opt.length === 3) {
    serveCmd.option(opt[0], opt[1], opt[2]);
  } else {
    serveCmd.option(opt[0], opt[1]);
  }
}
serveCmd.action(async (options) => {
  await runServe(options.server, options.token, options.proxies, options.reconnectInterval, options.maxReconnect);
});

// ====== stop 命令 ======

program
  .command('stop')
  .description('停止客户端')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      return;
    }

    try {
      process.kill(info.pid, 'SIGTERM');
    } catch (err) {
      console.log(chalk.yellow(`停止客户端失败: ${err instanceof Error ? err.message : err}`));
    }

    // 清理代理请求目录
    try {
      const { readdirSync, unlinkSync, existsSync } = require('fs');
      const REQUEST_DIR = require('./path').join(require('os').homedir(), '.chuantou', 'proxy-requests');
      if (existsSync(REQUEST_DIR)) {
        const files = readdirSync(REQUEST_DIR);
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.resp')) {
            try {
              unlinkSync(require('./path').join(REQUEST_DIR, file));
            } catch {
              // 忽略错误
            }
          }
        }
      }
    } catch {
      // 忽略清理错误
    }

    removePidFile();
    console.log(chalk.green('客户端已停止'));
  });

// ====== status 命令 ======

program
  .command('status')
  .description('查询客户端状态')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      return;
    }

    const uptime = Math.floor((Date.now() - info.startedAt) / 1000);
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;

    console.log(chalk.blue.bold('穿透客户端状态'));
    console.log(chalk.gray(`  运行中: 是`));
    console.log(chalk.gray(`  服务器: ${info.serverUrl}`));
    console.log(chalk.gray(`  PID: ${info.pid}`));
    console.log(chalk.gray(`  运行时长: ${minutes}分${seconds}秒`));

    // 尝试获取代理列表状态
    try {
      const proxies = await getProxiesFromRunningClient(info.serverUrl);
      if (proxies.length > 0) {
        console.log(chalk.gray(`  代理数量: ${proxies.length}`));
      }
    } catch {
      // 无法获取代理列表，可能客户端还未完全启动
    }
  });

// ====== list 命令（列出代理）======

program
  .command('list')
  .description('列出当前代理映射')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      return;
    }

    try {
      const proxies = await getProxiesFromRunningClient(info.serverUrl);
      if (proxies.length === 0) {
        console.log(chalk.yellow('没有代理映射'));
        return;
      }

      console.log(chalk.blue.bold('当前代理映射:'));
      console.log();
      for (const proxy of proxies) {
        const protocol = proxy.protocol || 'http';
        console.log(chalk.gray(`  :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort} (${protocol})`));
      }
    } catch (err) {
      console.log(chalk.yellow(`获取代理列表失败: ${err instanceof Error ? err.message : err}`));
    }
  });

/**
 * 向正在运行的客户端添加代理映射
 * 通过写入请求文件，让主客户端进程来处理注册
 */
async function addProxyToRunningClient(serverUrl: string, token: string | undefined, proxy: ProxyConfig): Promise<void> {
  // 检查服务器地址是否匹配
  const info = readPidFile();
  if (info && info.serverUrl !== serverUrl) {
    throw new Error('服务器地址不匹配');
  }

  // 创建请求目录
  mkdirSync(REQUEST_DIR, { recursive: true });

  // 写入请求文件
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const requestFilePath = join(REQUEST_DIR, `${requestId}.json`);

  const requestData = {
    type: 'add-proxy',
    proxy,
    timestamp: Date.now(),
  };

  writeFileSync(requestFilePath, JSON.stringify(requestData, null, 2));

  // 等待响应文件
  const responseFilePath = join(REQUEST_DIR, `${requestId}.resp`);
  const timeout = 10000; // 10秒超时
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (existsSync(responseFilePath)) {
      const response = JSON.parse(readFileSync(responseFilePath, 'utf-8'));
      // 清理请求和响应文件
      try {
        unlinkSync(requestFilePath);
        unlinkSync(responseFilePath);
      } catch {}

      if (response.success) {
        console.log(chalk.green(`✓ 代理已添加: :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`));
        return;
      } else {
        const errorMsg = response.error || '未知错误';
        // 检查是否是重复代理错误
        if (errorMsg.includes('已存在') || errorMsg.includes('already') || errorMsg.includes('duplicate')) {
          console.log(chalk.yellow(`⚠  代理已存在: :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`));
          return;
        }
        throw new Error(errorMsg);
      }
    }
    await new Promise(r => setTimeout(r, 100));
  }

  // 超时，清理请求文件
  try {
    unlinkSync(requestFilePath);
  } catch {}
  throw new Error('添加代理超时');
}

/**
 * 从正在运行的客户端获取代理列表
 */
async function getProxiesFromRunningClient(serverUrl: string): Promise<ProxyConfig[]> {
  return new Promise<ProxyConfig[]>((resolve, reject) => {
    const ws = new WebSocket(serverUrl);

    const timeout = setTimeout(() => {
      ws.close();
      resolve([]);
    }, 3000);

    ws.on('open', async () => {
      // 发送获取代理列表请求（使用心跳消息保持连接）
      const heartbeatMsg = createMessage(MessageType.HEARTBEAT, {
        timestamp: Date.now(),
      });

      ws.send(JSON.stringify(heartbeatMsg));

      // 这里简化处理，实际上应该有一个专门的 GET_PROXIES 消息类型
      // 目前返回空数组
      clearTimeout(timeout);
      ws.close();
      resolve([]);
    });

    ws.on('error', () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

/**
 * 运行客户端（前台模式）
 */
async function runServe(
  serverUrl: string,
  token: string | undefined,
  proxies: string | undefined,
  reconnectInterval: string,
  maxReconnect: string,
  shouldOpenBrowser?: boolean
): Promise<void> {
  // 设置 process.argv 供 Config.load 读取
  process.argv = [
    process.argv[0],
    process.argv[1],
    '--server', serverUrl,
    '--reconnect-interval', reconnectInterval,
    '--max-reconnect', maxReconnect,
  ];
  if (token) process.argv.push('--token', token);
  if (proxies) process.argv.push('--proxies', proxies);

  // 动态导入 index 模块运行
  const { run } = await import('./index.js');

  // 如果需要打开浏览器，延迟打开
  if (shouldOpenBrowser) {
    setTimeout(() => {
      openBrowser('http://127.0.0.1:9001/');
    }, 3000);
  }

  await run();
}

program.parse();
