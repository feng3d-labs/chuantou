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
/** 默认配置文件路径 */
const DEFAULT_CONFIG_FILE = join(CLIENT_DIR, 'config.json');

/** 单个代理配置接口 */
interface ProxyEntry {
  /** 远程端口 */
  remotePort: number;
  /** 本地端口 */
  localPort: number;
  /** 本地主机（可选） */
  localHost?: string;
}

/** 客户端配置接口 */
interface ClientConfig {
  /** 服务器地址 */
  server: string;
  /** 认证令牌 */
  token?: string;
  /** 代理配置列表 */
  proxies?: ProxyEntry[];
}

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
 * 将代理数组转换为命令行参数字符串
 */
function proxiesToString(proxies: ProxyEntry[] | undefined): string | undefined {
  if (!proxies || proxies.length === 0) return undefined;
  return proxies.map(p =>
    p.localHost ? `${p.remotePort}:${p.localPort}:${p.localHost}` : `${p.remotePort}:${p.localPort}`
  ).join(',');
}

/**
 * 解析代理字符串为代理列表
 */
function parseProxiesString(proxiesStr: string): ProxyEntry[] {
  return proxiesStr.split(',').map(part => {
    const segments = part.split(':');
    const entry: ProxyEntry = {
      remotePort: parseInt(segments[0], 10),
      localPort: parseInt(segments[1], 10),
    };
    if (segments.length > 2) {
      entry.localHost = segments[2];
    }
    return entry;
  });
}

/**
 * 运行客户端（前台模式）
 */
async function runServe(
  serverUrl: string,
  token: string | undefined,
  proxies: ProxyEntry[] | undefined,
  shouldOpenBrowser?: boolean,
): Promise<void> {
  // 设置 process.argv 供 Config.load 读取
  const proxiesStr = proxiesToString(proxies);
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

// ====== _serve 命令（隐藏，前台运行，供 start 和开机启动调用）======

const serveCmd = program.command('_serve', { hidden: true }).description('前台运行客户端（内部命令）');
serveCmd.option('-c, --config <path>', '配置文件路径');
for (const opt of commonOptions) {
  if (opt.length === 3) {
    serveCmd.option(opt[0], opt[1], opt[2]);
  } else {
    serveCmd.option(opt[0], opt[1]);
  }
}
serveCmd.action(async (options) => {
  // 从配置文件读取参数（开机启动时使用默认配置文件）
  const configPath = options.config || DEFAULT_CONFIG_FILE;
  let configOpts: ClientConfig | null = null;
  try {
    const configContent = readFileSync(configPath, 'utf-8');
    configOpts = JSON.parse(configContent);
    console.log(chalk.gray(`从配置文件读取参数: ${configPath}`));
  } catch {
    console.log(chalk.yellow(`配置文件不存在，使用命令行参数`));
  }

  // 命令行参数覆盖配置文件参数
  const serverUrl = configOpts?.server || options.server;
  const token = configOpts?.token || options.token;
  let proxyList: ProxyEntry[] | undefined;
  if (typeof configOpts?.proxies === 'string') {
    // 配置文件中的 proxies 是字符串格式，需要解析
    proxyList = parseProxiesString(configOpts.proxies);
  } else if (configOpts?.proxies) {
    // 配置文件中的 proxies 已经是数组格式
    proxyList = configOpts.proxies;
  } else if (typeof options.proxies === 'string') {
    // 命令行参数中的 proxies 是字符串格式，需要解析
    proxyList = parseProxiesString(options.proxies);
  } else {
    // 命令行参数中的 proxies 可能已经是数组格式（但实际不应该是）
    proxyList = options.proxies;
  }

  if (!serverUrl) {
    console.log(chalk.red('错误: 必须指定服务器地址（--config 或 --server）'));
    process.exit(1);
  }

  await runServe(serverUrl, token, proxyList);
});

// ====== start 命令（启动）======

const startCmd = program.command('start').alias('ks').description('启动客户端');
startCmd.option('-c, --config <path>', '配置文件路径（指定时不允许携带其他参数）');
startCmd.option('--no-boot', '不注册开机自启动');
// 添加原有的命令行选项
for (const opt of commonOptions) {
  if (opt.length === 3) {
    startCmd.option(opt[0], opt[1], opt[2]);
  } else {
    startCmd.option(opt[0], opt[1]);
  }
}
startCmd.action(async (options) => {
  // 1. 检测是否已在运行
  if (isClientRunning()) {
    const info = readPidFile();
    console.log(chalk.red('客户端已在运行中'));
    if (info) {
      console.log(chalk.gray(`  PID: ${info.pid}`));
      console.log(chalk.gray(`  服务器: ${info.serverUrl}`));
    }
    process.exit(1);
  }

  // 2. 确定使用的配置文件路径
  let configPath = DEFAULT_CONFIG_FILE;
  let useCustomConfig = false;

  if (options.config) {
    // 指定了配置文件
    configPath = options.config;
    useCustomConfig = true;

    // 检查是否同时指定了其他参数（不允许，但 --no-boot 除外）
    // 需要排除参数值（如配置文件路径）
    const allowedFlags = ['--config', '-c', '--no-boot', 'start', 'ks'];
    const otherArgs: string[] = [];
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (allowedFlags.includes(arg)) {
        // 如果是带值的选项，跳过下一个参数
        if (arg === '--config' || arg === '-c') {
          i++;
        }
      } else if (!arg.startsWith('-')) {
        // 可能是前一个选项的值，已经跳过了
        continue;
      } else {
        otherArgs.push(arg);
      }
    }
    if (otherArgs.length > 0) {
      console.log(chalk.red('错误: 指定配置文件时不允许携带其他参数'));
      process.exit(1);
    }
  } else {
    // 未指定配置文件，检查是否有命令行参数
    const hasServerArg = process.argv.includes('--server') || process.argv.includes('-s');
    const hasTokenArg = process.argv.includes('--token') || process.argv.includes('-t');
    const hasProxiesArg = process.argv.includes('--proxies') || process.argv.includes('-p');

    if (!hasServerArg && !hasTokenArg && !hasProxiesArg) {
      // 没有任何参数，尝试使用默认配置文件
      useCustomConfig = false;
    } else {
      // 有命令行参数，重新生成配置文件
      useCustomConfig = false;
    }
  }

  // 3. 读取配置或从命令行参数获取
  let serverUrl: string | undefined;
  let token: string | undefined;
  let proxyList: ProxyEntry[] | undefined;

  if (useCustomConfig || (!options.config && !process.argv.includes('--server') && !process.argv.includes('-s'))) {
    // 从配置文件读取
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      const config: ClientConfig = JSON.parse(configContent);
      serverUrl = config.server;
      token = config.token;
      proxyList = config.proxies;
      console.log(chalk.gray(`从配置文件读取参数: ${configPath}`));
    } catch {
      console.log(chalk.red(`错误: 配置文件不存在或格式错误: ${configPath}`));
      process.exit(1);
    }
  } else {
    // 从命令行参数获取
    const opts = startCmd.opts();
    serverUrl = opts.server;
    token = opts.token;
    // 解析代理字符串为代理列表
    if (opts.proxies) {
      proxyList = parseProxiesString(opts.proxies);
    }

    if (!serverUrl) {
      console.log(chalk.red('错误: 必须指定服务器地址（--server 或使用配置文件）'));
      process.exit(1);
    }

    // 保存到默认配置文件（用于开机启动）
    const configToSave: ClientConfig = { server: serverUrl };
    if (token) configToSave.token = token;
    if (proxyList) configToSave.proxies = proxyList;
    mkdirSync(CLIENT_DIR, { recursive: true });
    writeFileSync(DEFAULT_CONFIG_FILE, JSON.stringify(configToSave, null, 2));
    console.log(chalk.gray(`配置已保存到: ${DEFAULT_CONFIG_FILE}`));
  }

  if (!serverUrl) {
    console.log(chalk.red('错误: 必须指定服务器地址'));
    process.exit(1);
  }

  // 4. 确保数据目录存在
  mkdirSync(CLIENT_DIR, { recursive: true });

  // 5. 解析路径
  const scriptPath = fileURLToPath(import.meta.url);
  const nodePath = process.execPath;

  // 6. 构建 _serve 参数（优先使用 --config 指向配置文件）
  const serveArgs: string[] = [];
  // 始终使用 --config 参数，这样 boot.json 中保存的是配置文件路径而非展开的参数
  const bootConfigPath = useCustomConfig ? configPath : DEFAULT_CONFIG_FILE;
  serveArgs.push('--config', bootConfigPath);

  // 7. 打开日志文件
  const logFd = openSync(LOG_FILE, 'a');

  // 8. 启动后台守护进程
  const child = spawn(nodePath, [scriptPath, '_serve', ...serveArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });

  // 立即写入 PID 文件，防止重复启动
  if (child.pid !== undefined) {
    writePidFile({
      pid: child.pid,
      serverUrl,
      startedAt: Date.now(),
    });
  }

  child.unref();
  closeSync(logFd);

  // 9. 等待客户端启动（通过检查管理服务器）
  await new Promise(resolve => setTimeout(resolve, 2000));

  const status = await getClientStatus();
  if (!status) {
    console.log(chalk.yellow('客户端已启动，但管理服务器未就绪'));
  } else {
    console.log(chalk.green('客户端已在后台启动'));
    console.log(chalk.gray(`  PID: ${child.pid}`));
    console.log(chalk.gray(`  服务器: ${serverUrl}`));
    console.log(chalk.gray(`  管理页面: ${ADMIN_URL}/`));
  }
  console.log(chalk.gray(`  日志: ${LOG_FILE}`));

  // 10. 注册开机启动
  if (options.boot !== false) {
    try {
      registerBoot({
        isServer: false,
        nodePath,
        scriptPath,
        args: serveArgs,
      });
      console.log(chalk.green('已注册开机自启动'));
    } catch (err) {
      console.log(chalk.yellow(`注册开机自启动失败: ${err instanceof Error ? err.message : err}`));
    }
  }
});

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
    } else {
      const uptime = Math.floor((Date.now() - info.startedAt) / 1000);
      const minutes = Math.floor(uptime / 60);
      const seconds = uptime % 60;
      console.log(chalk.gray(`  运行时长: ${minutes}分${seconds}秒`));
      console.log(chalk.gray(`  (管理服务器未就绪，部分信息不可用)`));
    }
  });

program.parse();
