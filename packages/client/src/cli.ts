#!/usr/bin/env node

/**
 * @module cli
 * @description 穿透客户端命令行工具模块。
 * 提供 `feng3d-ctc` CLI 命令，支持启动、停止和查询客户端状态。
 * 单实例模式：只允许一个客户端实例运行。
 * 支持从配置文件读取启动参数（开机启动时使用）
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync, closeSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { get as httpGet } from 'http';
import { ProxyConfig } from '@feng3d/chuantou-shared';
import { registerBoot, unregisterBoot, isBootRegistered } from '@feng3d/chuantou-shared/boot';

/** 客户端实例数据目录 */
const DATA_DIR = join(homedir(), '.chuantou');
/** 客户端数据目录路径 */
const CLIENT_DIR = join(DATA_DIR, 'client');
/** PID 文件路径 */
const PID_FILE = join(CLIENT_DIR, 'client.pid');
/** 日志文件路径 */
const LOG_FILE = join(CLIENT_DIR, 'client.log');
/** 配置文件路径 */
const CONFIG_FILE = join(CLIENT_DIR, 'boot.json');

/** 客户端信息接口 */
interface ClientInfo {
  /** 服务器地址 */
  serverUrl: string;
  /** 进程 ID */
  pid: number;
  /** 启动时间 */
  startedAt: number;
}

/**
 * 写入 PID 文件
 */
function writePidFile(info: ClientInfo): void {
  mkdirSync(CLIENT_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

/**
 * 读取 PID 文件
 */
function readPidFile(): ClientInfo | null {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
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

/** 管理服务器地址 */
const ADMIN_URL = 'http://127.0.0.1:9001';

/**
 * 从管理服务器获取客户端状态
 */
async function getClientStatus(): Promise<{ proxies: ProxyConfig[]; connected: boolean; authenticated: boolean; uptime: number; reconnectAttempts: number } | null> {
  return new Promise((resolve) => {
    const req = httpGet(`${ADMIN_URL}/_ctc/status`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * 运行客户端（前台模式）
 */
async function runServe(
  serverUrl: string,
  token: string | undefined,
  proxiesStr: string | undefined,
  shouldOpenBrowser?: boolean,
): Promise<void> {
  // 设置 process.argv 供 Config.load 读取
  process.argv = [
    process.argv[0],
    process.argv[1],
    '--server', serverUrl,
    ...(token ? ['--token', token] : []),
    ...(proxiesStr ? ['--proxies', proxiesStr] : []),
  ];

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

/** 通用选项（服务端与客户端共用）*/
const commonOptions = [
  ['-s, --server <url>', '服务器地址'],
  ['-t, --token <token>', '认证令牌'],
  ['-p, --proxies <proxies>', '代理配置（格式: remotePort:localPort[:localHost]，逗号分隔多个）'],
];

const program = new Command();

program
  .name('feng3d-ctc')
  .description(chalk.blue('穿透 - 内网穿透客户端'))
  .version('0.0.5');

// ====== start 命令（启动）======

const startCmd = program.command('start').alias('ks').description('启动客户端');
for (const opt of commonOptions) {
  if (opt.length === 3) {
    startCmd.option(opt[0], opt[1], opt[2]);
  } else {
    startCmd.option(opt[0], opt[1]);
  }
}

// ====== stop 命令（停止）======

program
  .command('stop')
  .alias('tz')
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

    removePidFile();
    unregisterBoot();
    console.log(chalk.green('客户端已停止'));
  });

// ====== status 命令（状态）======

program
  .command('status')
  .alias('zt')
  .description('查询客户端状态')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      return;
    }

    console.log(chalk.blue.bold('穿透客户端状态'));
    console.log(chalk.gray(`  PID: ${info.pid}`));
    console.log(chalk.gray(`  服务器: ${info.serverUrl}`));
    console.log(chalk.gray(`  管理页面: ${ADMIN_URL}/`));
    console.log(chalk.gray(`  开机启动: ${isBootRegistered() ? '已启用' : '未启用'}`));

    const status = await getClientStatus();
    if (status) {
      const uptime = Math.floor(status.uptime / 1000);
      const minutes = Math.floor(uptime / 60);
      const seconds = uptime % 60;

      console.log(chalk.gray(`  连接状态: ${status.authenticated ? '已认证' : status.connected ? '已连接' : '未连接'}`));
      if (uptime > 0) {
        console.log(chalk.gray(`  运行时长: ${minutes}分${seconds}秒`));
      }
      if (status.reconnectAttempts > 0) {
        console.log(chalk.gray(`  重连次数: ${status.reconnectAttempts} 次`));
      }

      if (status.proxies.length === 0) {
        console.log(chalk.gray(`  代理映射: 无`));
      } else {
        console.log(chalk.gray(`  代理映射: ${status.proxies.length} 个`));
        for (const proxy of status.proxies) {
          console.log(chalk.gray(`    :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`));
        }
      }
    }
  } else {
      const uptime = Math.floor((Date.now() - info.startedAt) / 1000);
      const minutes = Math.floor(uptime / 60);
      const seconds = uptime % 60;
      console.log(chalk.gray(`  运行时长: ${minutes}分${seconds}秒`));
      console.log(chalk.gray(`  (管理服务器未就绪，部分信息不可用)`));
    }
  });
