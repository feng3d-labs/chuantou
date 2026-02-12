#!/usr/bin/env node

/**
 * @module cli
 * @description 穿透客户端命令行工具模块。
 * 提供 `feng3d-ctc` CLI 命令，支持启动、停止、查询状态、添加和移除代理映射。
 * 单实例模式：只允许一个客户端实例运行。
 * 支持从配置文件读取启动参数（开机启动时使用）
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync, closeSync, appendFileSync } from 'fs';
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

/** 管理服务器 URL */
const ADMIN_URL = 'http://127.0.0.1:9001';

/**
 * 单个代理配置接口
 */
interface ProxyEntry {
  /** 远程端口 */
  remotePort: number;
  /** 本地端口 */
  localPort: number;
  /** 本地主机（可选） */
  localHost?: string;
}

/**
 * 客户端配置接口
 */
interface ClientConfig {
  /** 服务器地址 */
  server: string;
  /** 认证令牌 */
  token?: string;
  /** 代理配置列表 */
  proxies?: ProxyEntry[];
}

/**
 * 客户端信息接口
 */
interface ClientInfo {
  /** 服务器地址 */
  serverUrl: string;
  /** 进程 ID */
  pid: number;
  /** 启动时间 */
  startedAt: number;
  /** 上次重启时间（用于崩溃自动重启） */
  lastRestartTime?: number;
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
    return false;
  }
}

/**
 * 获取客户端状态
 */
async function getClientStatus(): Promise<{ proxies: ProxyConfig[]; connected: boolean; authenticated: boolean; uptime: number; reconnectAttempts?: number } | null> {
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
    req.setTimeout(3000, () => resolve(null));
  });
}

/**
 * 获取下一个代理编号（用于 CLI 命令行）
 */
let nextProxyIndex = 1;

/**
 * 获取下一个代理编号
 */
function getProxyIndex(): number {
  return nextProxyIndex++;
}

/**
 * 写入客户端配置文件
 */
function writeConfig(config: ClientConfig): void {
  mkdirSync(CLIENT_DIR, { recursive: true });
  writeFileSync(DEFAULT_CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * 读取客户端配置文件
 */
function readConfig(): ClientConfig | null {
  try {
    return JSON.parse(readFileSync(DEFAULT_CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

const program = new Command();

program
  .name('feng3d-ctc')
  .description(chalk.blue('穿透 - 内网穿透客户端'))
  .version('0.0.5');

// ====== _serve 命令（隐藏，前台运行，供 start 和开机启动调用）======

const serveCmd = program.command('_serve', { hidden: true }).description('前台运行客户端（内部命令）');
serveCmd.option('-c, --config <path>', '配置文件路径');
serveCmd.action(async (options) => {
  const configPath = options.config || DEFAULT_CONFIG_FILE;
  let config: ClientConfig | null = null;

  try {
    const configContent = readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch {
    console.log(chalk.red(`配置文件不存在或格式错误: ${configPath}`));
    process.exit(1);
  }

  if (!config?.server) {
    console.log(chalk.red('配置文件缺少 server 字段'));
    process.exit(1);
  }

  // 动态导入并运行客户端
  const { run } = await import('./index.js');
  await run();
});

// ====== start 命令（后台守护进程 + 开机启动）======

const serverOptions = [
  ['-p, --port <port>', '控制端口', '9000'],
  ['-a, --host <address>', '监听地址', '0.0.0.0'],
  ['-t, --tokens <tokens>', '认证令牌（逗号分隔）'],
  ['--tls-key <path>', 'TLS 私钥文件路径'],
  ['--tls-cert <path>', 'TLS 证书文件路径'],
  ['--heartbeat-interval <ms>', '心跳间隔（毫秒）', '30000'],
  ['--session-timeout <ms>', '会话超时（毫秒）', '60000'],
] as const;

const startCmd = program.command('start')
  .description('启动客户端（后台运行并注册开机自启动）')
  .option('-c, --config <path>', '配置文件路径（指定时不允许携带其他参数）');

for (const opt of serverOptions) {
  if (opt.length === 3) {
    startCmd.option(opt[0], opt[1], opt[2]);
  } else {
    startCmd.option(opt[0], opt[1]);
  }
}
startCmd.option('--no-boot', '不注册开机自启动');
startCmd.option('-o, --open', '启动后在浏览器中打开状态页面');

startCmd.action(async (options) => {
  // 1. 检测是否已在运行
  if (isClientRunning()) {
    console.log(chalk.red('客户端已在运行中'));
    console.log(chalk.gray(`  PID: ${readPidFile()!.pid}`));
    console.log(chalk.yellow('如需重启，请先使用 stop 命令停止'));
    process.exit(1);
  }

  // 2. 确定使用的配置文件路径和读取配置
  let configPath = DEFAULT_CONFIG_FILE;
  let useCustomConfig = false;
  let config: ClientConfig | null = null;

  if (options.config) {
    configPath = options.config;
    useCustomConfig = true;

    // 从配置文件读取
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      config = JSON.parse(configContent);
      if (config && !config.server) {
        console.log(chalk.red(`错误: 配置文件缺少 server 字段`));
        process.exit(1);
      }
    } catch {
      console.log(chalk.yellow('配置文件不存在或格式错误，使用命令行参数'));
    }
  } else {
    // 检查是否有命令行参数（排除 --config 和 --no-boot 和 --open）
    const hasPortArg = process.argv.includes('--port') || process.argv.includes('-p');
    const hasHostArg = process.argv.includes('--host') || process.argv.includes('-a');
    const hasTokensArg = process.argv.includes('--tokens') || process.argv.includes('-t');
    const hasTlsKeyArg = process.argv.includes('--tls-key');
    const hasTlsCertArg = process.argv.includes('--tls-cert');

    if (!hasPortArg && !useCustomConfig) {
      // 没有配置文件也没有端口参数，尝试读取默认配置
      try {
        const configContent = readFileSync(DEFAULT_CONFIG_FILE, 'utf-8');
        config = JSON.parse(configContent);
        if (!config || !config.server) {
          console.log(chalk.red('错误: 必须指定参数（--port 或使用配置文件）'));
          process.exit(1);
        }
      } catch {
        console.log(chalk.red('错误: 必须指定参数（--port 或使用配置文件）'));
        process.exit(1);
      }
    }
  }

  // 3. 构建启动参数
  const server = config?.server || 'ws://localhost:9000';
  const serverUrl = config?.server || server;

  // 4. 解析路径
  const scriptPath = fileURLToPath(import.meta.url);
  const nodePath = process.execPath;

  // 5. 构建 _serve 参数（始终使用 --config 指向配置文件）
  const serveArgs = ['--config', configPath];

  // 6. 打开日志文件
  const logFd = openSync(LOG_FILE, 'a');

  // 7. 启动后台守护进程
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

  // 8. 监控守护进程，异常退出时自动重启
  let restartCount = 0;
  const MAX_RESTART_INTERVAL = 60000; // 60秒内最多重启一次

  const watchDaemon = async () => {
    return new Promise<void>((resolve) => {
      child.on('exit', (code, signal) => {
        // 正常退出（SIGTERM/SIGINT）不重启
        if (signal === 'SIGTERM' || signal === 'SIGINT') {
          resolve();
          return;
        }

        // 异常退出，记录日志
        const timestamp = new Date().toISOString();
        const crashLog = `[${timestamp}] 守护进程异常退出: code=${code}, signal=${signal}\n`;
        appendFileSync(LOG_FILE, crashLog);

        // 检查是否需要重启（排除 stop 命令触发的退出）
        const pidInfo = readPidFile();
        if (pidInfo && pidInfo.pid === child.pid) {
          // PID 文件仍指向我们启动的进程，说明是异常退出
          const now = Date.now();
          const timeSinceLastRestart = now - (pidInfo.lastRestartTime || 0);

          if (timeSinceLastRestart > MAX_RESTART_INTERVAL) {
            // 距离上次重启超过 60 秒，允许重启
            restartCount = 0;
          }

          if (restartCount < 5) {
            // 最多连续重启 5 次
            restartCount++;
            console.log(chalk.yellow(`守护进程异常退出，正在自动重启 (${restartCount}/5)...`));

            // 延迟 3 秒后重启，避免快速崩溃循环
            setTimeout(() => {
              const newChild = spawn(nodePath, [scriptPath, '_serve', ...serveArgs], {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
              });

              if (newChild.pid !== undefined) {
                writePidFile({
                  pid: newChild.pid,
                  serverUrl,
                  startedAt: Date.now(),
                  lastRestartTime: Date.now(),
                });
              }

              newChild.unref();
              watchDaemon(); // 继续监控新的守护进程
            }, 3000);
          } else {
            console.log(chalk.red('守护进程频繁崩溃，停止自动重启'));
            console.log(chalk.red('请检查日志排查问题'));
            removePidFile();
            resolve();
          }
        } else {
          // PID 文件不存在或已变更，说明是 stop 命令停止的
          resolve();
        }
      });
    });
  };

  // 启动监控
  await watchDaemon();

  // 9. 等待客户端启动（通过检查管理服务器）
  let status: Awaited<ReturnType<typeof getClientStatus>> = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    status = await getClientStatus();
    if (status) break;
  }

  if (!status) {
    console.log(chalk.yellow('客户端已启动，但管理服务器未就绪'));
    console.log(chalk.gray('  可能的原因:'));
    console.log(chalk.gray('    - 服务端未启动或无法连接'));
    console.log(chalk.gray('    - 管理服务器端口 9001 被占用'));
    console.log(chalk.gray(`  请查看日志: ${LOG_FILE}`));
  } else {
    console.log(chalk.green('客户端已在后台启动'));
    console.log(chalk.gray(`  PID: ${child.pid}`));
    console.log(chalk.gray(`   服务器: ${serverUrl}`));
    console.log(chalk.gray(`  管理页面: ${ADMIN_URL}/`));
  }

  console.log(chalk.gray(`  日志: ${LOG_FILE}`));

  // 9. 注册开机启动
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
    console.log(chalk.gray(`   服务器: ${info.serverUrl}`));
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
      if (status.reconnectAttempts && status.reconnectAttempts > 0) {
        console.log(chalk.gray(`  重连次数: ${status.reconnectAttempts} 次`));
      }

      if (status.proxies.length === 0) {
        console.log(chalk.gray(`  代理映射: 无`));
      } else {
        console.log(chalk.gray(`   代理映射: ${status.proxies.length} 个`));
        for (const proxy of status.proxies) {
          const index = (proxy as any).index ? `#${(proxy as any).index}` : ' -';
          console.log(chalk.gray(`    ${index} :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`));
        }
      }
    }
  });

// ====== add-proxy 命令（添加代理）======

program
  .command('add-proxy')
  .description('添加代理映射（需要客户端运行中）')
  .argument('<remote>:<local>', '远程端口:本地端口（如 8080:3000 或 2222:22）')
  .option('-h, --host <address>', '本地主机地址（默认为 localhost）')
  .action(async (remoteLocal, options) => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      console.log(chalk.gray('请先使用以下命令启动客户端：'));
      console.log(chalk.gray('  npx @feng3d/ctc start'));
      return;
    }

    // 解析参数
    const [remotePort, localPort] = remoteLocal.split(':');
    if (!remotePort || !localPort) {
      console.log(chalk.yellow('参数格式错误，应为 远程端口:本地端口（如 8080:3000 或 2222:22）'));
      return;
    }

    const remote = parseInt(remotePort, 10);
    const localParts = localPort.split(':');
    const local = localParts.length === 2 ? parseInt(localParts[1], 10) : parseInt(localParts[0], 10);
    const localHost = localParts.length === 2 ? localParts[0] : options.host || 'localhost';

    // 通过管理服务器 API 添加代理
    try {
      const res = await fetch(`http://127.0.0.1:9001/_ctc/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remotePort: remote,
          localPort: local,
          localHost: localHost,
        }),
      });

      if (res.ok) {
        console.log(chalk.green('代理映射已添加'));
        console.log(chalk.gray(`  #${getProxyIndex()} :${remote} -> ${localHost}:${local}`));

        // 更新配置文件
        const config = readConfig();
        if (config) {
          if (!config.proxies) config.proxies = [];
          config.proxies.push({ remotePort, localPort, localHost });
          writeConfig(config);
        } else {
          // 创建新配置文件
          writeConfig({
            server: 'ws://localhost:9000',
            proxies: [{ remotePort, localPort, localHost }],
          });
        }
      } else {
        console.log(chalk.red('添加代理失败'));
      }
    } catch (err) {
      console.log(chalk.red(`请求失败: ${err instanceof Error ? err.message : String(err)}`));
    }
  });

// ====== remove-proxy 命令（移除代理）======

program
  .command('remove-proxy')
  .alias('rp')
  .description('移除代理映射（需要客户端运行中）')
  .argument('<port>', '远程端口号')
  .action(async (remotePort) => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      console.log(chalk.gray('请先使用以下命令启动客户端：'));
      console.log(chalk.gray('  npx @feng3d/ctc start'));
      return;
    }

    const port = parseInt(remotePort, 10);
    if (isNaN(port)) {
      console.log(chalk.yellow('端口号格式错误'));
      return;
    }

    // 通过管理服务器 API 删除代理
    try {
      const res = await fetch(`http://127.0.0.1:9001/_ctc/proxies/${port}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        console.log(chalk.green('代理映射已移除'));
        console.log(chalk.gray(`  端口: ${port}`));

        // 更新配置文件
        const config = readConfig();
        if (config && config.proxies) {
          const index = config.proxies.findIndex(p => p.remotePort === port);
          if (index !== -1) {
            config.proxies.splice(index, 1);
            writeConfig(config);
          }
        }
      } else if (res.status === 404) {
        console.log(chalk.yellow('代理映射不存在'));
      } else {
        const data = await res.json() as { error?: string };
        console.log(chalk.red(`移除失败: ${data.error || '未知错误'}`));
      }
    } catch (err) {
      console.log(chalk.red(`请求失败: ${err instanceof Error ? err.message : String(err)}`));
    }
  });

program.parse();
