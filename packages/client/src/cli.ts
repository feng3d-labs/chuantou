#!/usr/bin/env node

/**
 * @module cli
 * @description 穿透客户端 CLI - 简洁的命令行工具
 *
 * 使用方法：
 *   npx @feng3d/cts start          # 启动客户端（后台守护进程）
 *   npx @feng3d/cts stop           # 停止客户端
 *   npx @feng3d/cts restart        # 重启客户端
 *   npx @feng3d/cts status         # 查看状态
 *   npx @feng3d/cts proxies        # 管理代理映射
 *   npx @feng3d/cts config         # 管理配置
 *   npx @feng3d/cts boot           # 管理开机自启动
 *   npx @feng3d/cts logs           # 查看日志
 *   npx @feng3d/cts open           # 打开管理页面
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, openSync, closeSync, readSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform } from 'os';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ProxyConfig, ClientConfig } from '@feng3d/chuantou-shared';
import { registerBoot, unregisterBoot, isBootRegistered } from '@feng3d/chuantou-shared/boot';

/** 数据目录 */
const DATA_DIR = join(homedir(), '.chuantou');

/**
 * PID 文件信息接口
 */
interface PidFileInfo {
  /** 进程 ID */
  pid: number;
  /** 服务器地址 */
  serverUrl: string;
  /** 启动时间戳 */
  startedAt: number;
  /** 最后重启时间戳（可选） */
  lastRestartTime?: number;
  /** 启动参数（用于开机自启动） */
  args?: string[];
}
/** 客户端目录 */
const CLIENT_DIR = join(DATA_DIR, 'client');
/** 配置文件 */
const CONFIG_FILE = join(CLIENT_DIR, 'config.json');
/** PID 文件 */
const PID_FILE = join(CLIENT_DIR, 'client.pid');
/** 日志文件 */
const LOG_FILE = join(CLIENT_DIR, 'client.log');
/** 管理服务器 URL */
const ADMIN_URL = 'http://127.0.0.1:9001';

/**
 * 帮助文本
 */
const HELP_TEXT = `
${chalk.bold('用法：')} cts <${chalk.bold('命令')}> [选项]

${chalk.bold('命令：')}
  ${chalk.cyan('start')}      启动客户端（后台守护进程）
  ${chalk.cyan('close')}      关闭客户端
  ${chalk.cyan('restart')}    重启客户端
  ${chalk.cyan('status')}     查看运行状态
  ${chalk.cyan('proxies')}    管理反向代理映射
  ${chalk.cyan('forward')}    管理正向穿透代理
  ${chalk.cyan('config')}     管理配置
  ${chalk.cyan('boot')}      管理开机自启动
  ${chalk.cyan('logs')}       查看日志
  ${chalk.cyan('open')}       打开管理页面

${chalk.bold('全局选项：')}
  ${chalk.yellow('-h, --help')}     显示帮助信息
  ${chalk.yellow('-v, --version')}  显示版本号

${chalk.bold('start 命令选项：')}
  ${chalk.yellow('--server <url>')}    服务器地址 (如: ws://localhost:9000)
  ${chalk.yellow('--token <token>')}     认证令牌
  ${chalk.yellow('--no-boot')}         不注册开机自启动
  ${chalk.yellow('--open')}            启动后打开管理页面

${chalk.bold('proxies 命令（反向代理）：')}
  ${chalk.yellow('list')}              列出所有代理映射
  ${chalk.yellow('add <remote:local>')}  添加代理 (如: 8080:3000)
  ${chalk.yellow('remove <port>')}     移除指定端口的代理
  ${chalk.yellow('clear')}            清空所有代理

${chalk.bold('forward 命令（正向穿透）：')}
  ${chalk.yellow('list')}              列出所有正向穿透代理
  ${chalk.yellow('add <local:remote:client>')}  添加穿透 (如: 8080:3000:clientB)
  ${chalk.yellow('remove <localPort>')} 移除指定本地端口的穿透
  ${chalk.yellow('clients')}           查看在线客户端列表
  ${chalk.yellow('register')}          注册到服务器启用正向穿透

${chalk.bold('config 命令选项：')}
  ${chalk.yellow('get [key]')}       获取配置项
  ${chalk.yellow('set <key> <value>')}  设置配置项
  ${chalk.yellow('list')}            列出所有配置
  ${chalk.yellow('edit')}           编辑配置文件

${chalk.bold('boot 命令选项：')}
  ${chalk.yellow('enable')}           启用开机自启动
  ${chalk.yellow('disable')}          禁用开机自启动

${chalk.dim('配置文件位置：')} ${CONFIG_FILE}
${chalk.dim('日志文件位置：')} ${LOG_FILE}
${chalk.dim('管理页面：')} http://127.0.0.1:9001

${chalk.dim('示例：')}
  ${chalk.gray('# 启动客户端')}
  cts start --server ws://192.168.1.100:9000 --token mytoken

  ${chalk.gray('# 正向穿透模式：注册并添加映射')}
  cts forward register --description "我的电脑"
  cts forward clients
  cts forward add 8080:3000:clientB
  cts forward list

  ${chalk.gray('# 反向代理模式：暴露本地服务')}
  cts proxies add 8080:3000
  cts proxies list

  ${chalk.gray('# 管理配置')}
  cts config set serverUrl ws://localhost:9000
  cts config set token mytoken

  ${chalk.gray('# 开机自启动')}
  cts boot enable
`;

/**
 * 版本号
 */
const VERSION = '0.1.0';

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log(HELP_TEXT);
}

/**
 * 显示版本号
 */
function showVersion() {
  console.log(`@feng3d/cts v${VERSION}`);
}

/**
 * 读取配置文件
 */
function readConfig(): ClientConfig | null {
  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 写入配置文件
 */
function writeConfig(config: ClientConfig): void {
  mkdirSync(CLIENT_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * 读取 PID 文件
 */
function readPidFile(): PidFileInfo | null {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 写入 PID 文件
 */
function writePidFile(info: PidFileInfo): void {
  mkdirSync(CLIENT_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
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
  try {
    const res = await fetch(`${ADMIN_URL}/_ctc/status`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json() as { proxies: ProxyConfig[]; connected: boolean; authenticated: boolean; uptime: number; reconnectAttempts?: number };
    return data;
  } catch {
    return null;
  }
}

/**
 * 脚本路径
 */
const cliPath = fileURLToPath(import.meta.url);
// index.js 是实际运行客户端的入口（包含管理服务器）
const indexPath = join(dirname(cliPath), 'index.js');
const nodePath = process.execPath;

/**
 * 主程序入口
 */
const program = new Command();

program
  .name('@feng3d/cts')
  .description(chalk.blue('穿透 - 内网穿透客户端'))
  .version(VERSION)
  .option('-h, --help', '显示帮助信息')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    if ((options as any).help) {
      showHelp();
      process.exit(0);
    }
  });

// ==================== start 命令 ====================

const startCmd = program.command('start')
  .description('启动客户端（后台守护进程）')
  .option('--server <url>', '服务器地址')
  .option('--token <token>', '认证令牌')
  .option('--no-boot', '不注册开机自启动')
  .option('-o, --open', '启动后打开管理页面')
  .action(async (options) => {
    // 检查是否已在运行
    if (isClientRunning()) {
      const info = readPidFile();
      console.log(chalk.yellow('客户端已在运行中'));
      console.log(chalk.gray(`  PID: ${info?.pid}`));
      console.log(chalk.gray(`  服务器: ${info?.serverUrl}`));
      return;
    }

    // 加载配置
    let serverUrl = options.server;
    let token = options.token;

    // 如果命令行没有指定，从配置文件读取
    if (!serverUrl || !token) {
      const config = readConfig();
      if (config) {
        if (!serverUrl) serverUrl = config.serverUrl;
        if (!token) token = config.token || '';
      }
    }

    // 如果仍然没有服务器地址，使用默认值
    if (!serverUrl) {
      console.log(chalk.yellow('未指定服务器地址'));
      console.log(chalk.gray('使用方法：'));
      console.log(chalk.gray('  1. npx @feng3d/cts config set serverUrl <url>'));
      console.log(chalk.gray('  2. npx @feng3d/cts start --server <url>'));
      process.exit(1);
    }

    // 启动参数
    const serveArgs = ['--config', CONFIG_FILE];
    if (serverUrl) serveArgs.push('--server', serverUrl);
    if (token) serveArgs.push('--token', token);

    // 打开日志文件
    const logFd = openSync(LOG_FILE, 'a');

    // 启动守护进程
    const child = spawn(nodePath, [indexPath, ...serveArgs], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });

    // 写入 PID 文件
    if (child.pid !== undefined) {
      writePidFile({
        pid: child.pid,
        serverUrl,
        startedAt: Date.now(),
      });
    }

    child.unref();
    closeSync(logFd);

    console.log(chalk.green('客户端已在后台启动'));
    console.log(chalk.gray(`  PID: ${child.pid}`));
    console.log(chalk.gray(`  服务器: ${serverUrl}`));
    console.log(chalk.gray(`  配置: ${CONFIG_FILE}`));
    console.log(chalk.gray(`  日志: ${LOG_FILE}`));

    // 如果需要开机自启动
    if (options.boot !== false) {
      try {
        registerBoot({
          isServer: false,
          nodePath,
          scriptPath: indexPath,
          args: serveArgs,
        });
        console.log(chalk.green('已启用开机自启动'));
      } catch (err: any) {
        console.log(chalk.yellow(`注册开机自启动失败: ${err.message}`));
      }
    }

    // 打开管理页面
    if (options.open) {
      setTimeout(() => {
        const adminPage = 'http://127.0.0.1:9001';
        console.log(chalk.gray(`打开管理页面: ${adminPage}`));
        const openCmd = platform() === 'win32' ? 'start' : 'open';
        execSync(`${openCmd} ${adminPage}`, { stdio: 'ignore' });
      }, 1000);
    }
  });

// ==================== close 命令 ====================

const closeCmd = program.command('close')
  .description('关闭客户端')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      return;
    }

    try {
      process.kill(info.pid, 'SIGTERM');
    } catch (err: any) {
      console.log(chalk.yellow(`关闭失败: ${err.message}`));
      return;
    }

    removePidFile();

    // 取消开机自启动
    try {
      unregisterBoot();
    } catch (err: any) {
      // ignore
    }

    console.log(chalk.green('客户端已关闭'));
  });

// ==================== restart 命令 ====================

const restartCmd = program.command('restart')
  .description('重启客户端')
  .action(async () => {
    console.log(chalk.blue('正在重启客户端...'));

    const info = readPidFile();
    const pid = info?.pid;

    // 先停止
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(chalk.gray(`已发送停止信号到 PID ${pid}`));
      } catch (err: any) {
        console.log(chalk.yellow(`停止失败: ${err.message}`));
      }
    }

    // 等待进程结束
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 清除 PID 文件，让 start 命令重新读取
    removePidFile();

    // 重新启动（不带参数，使用配置文件）
    // 启动一个新的 start 命令进程
    const startChild = spawn(nodePath, [cliPath, 'start'], {
      detached: true,
      stdio: 'ignore',
    });

    startChild.unref();
    console.log(chalk.green('客户端已重启'));
  });

// ==================== status 命令 ====================

const statusCmd = program.command('status')
  .description('查看运行状态')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未在运行'));
      console.log(chalk.gray('状态: 已停止'));
      return;
    }

    console.log(chalk.blue.bold('穿透客户端状态'));
    console.log(chalk.gray(`  PID: ${info.pid}`));
    console.log(chalk.gray(`  服务器: ${info.serverUrl}`));
    console.log(chalk.gray(`  配置: ${CONFIG_FILE}`));
    console.log(chalk.gray(`  日志: ${LOG_FILE}`));
    console.log(chalk.gray(`  启动时间: ${new Date(info.startedAt).toLocaleString('zh-CN')}`));
    console.log(chalk.gray(`  开机启动: ${isBootRegistered() ? '已启用' : '未启用'}`));

    // 获取详细状态
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
        console.log(chalk.gray(`  重连次数: ${status.reconnectAttempts}次`));
      }
      if (status.proxies.length === 0) {
        console.log(chalk.gray('  代理映射: 无'));
      } else {
        console.log(chalk.gray(`  代理映射: ${status.proxies.length}个`));
        for (const proxy of status.proxies) {
          const index = (proxy as any).index ? `#${(proxy as any).index}` : ' -';
          const target = (proxy as any).localHost || 'localhost';
          console.log(chalk.gray(`    ${index} ${proxy.remotePort} -> ${target}:${proxy.localPort}`));
        }
      }
    } else {
      console.log(chalk.yellow('无法获取状态（管理服务器未就绪）'));
    }
  });

// ==================== proxies 命令 ====================

const proxiesCmd = program.command('proxies')
  .description('管理代理映射')
  .argument('[command]', '子命令：list, add, remove, clear', { default: 'list' });

// proxies list 子命令
proxiesCmd.command('list')
  .description('列出现有代理映射')
  .action(async () => {
    const config = readConfig();
    const proxies = config?.proxies || [];

    if (proxies.length === 0) {
      console.log(chalk.yellow('暂无代理映射'));
      return;
    }

    console.log(chalk.blue.bold('代理映射列表：'));
    for (let i = 0; i < proxies.length; i++) {
      const proxy = proxies[i];
      const index = (proxy as any).index ? `#${(proxy as any).index}` : ' -';
      const target = (proxy as any).localHost || 'localhost';
      console.log(`  ${chalk.cyan(index)} ${chalk.cyan(proxy.remotePort.toString())} -> ${chalk.cyan(target)}:${chalk.cyan(proxy.localPort.toString())}`);
    }
  });

// proxies add 子命令
proxiesCmd.command('add')
  .description('添加代理映射')
  .argument('<remote:local>', '远程端口:本地端口 (如: 8080:3000 或 8080:3000:192.168.1.100)')
  .option('-h, --host <address>', '本地主机地址 (默认为 localhost)')
  .action(async (remoteLocal, options) => {
    // 解析参数
    const parts = remoteLocal.split(':');
    if (parts.length < 2) {
      console.log(chalk.yellow('参数格式错误，应为：远程端口:本地端口'));
      console.log(chalk.gray('示例：8080:3000 或 8080:3000:192.168.1.100'));
      return;
    }

    const remotePort = parseInt(parts[0], 10);
    let localPort: number;
    let localHost = 'localhost';

    // 检查是否有第三部分（主机地址）
    if (parts.length >= 3) {
      localPort = parseInt(parts[1], 10);
      localHost = parts[2];
    } else {
      localPort = parseInt(parts[1], 10);
    }

    // 验证端口
    if (isNaN(remotePort) || remotePort < 1024 || remotePort > 65535) {
      console.log(chalk.yellow('远程端口无效：1024-65535'));
      return;
    }
    if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
      console.log(chalk.yellow('本地端口无效：1-65535'));
      return;
    }

    // 通过 API 添加
    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/proxies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remotePort,
          localPort,
          localHost,
        }),
      });

      if (res.ok) {
        console.log(chalk.green('代理映射已添加'));

        // 更新本地配置文件
        const config = readConfig();
        if (config) {
          if (!config.proxies) config.proxies = [];
          config.proxies.push({ remotePort, localPort, localHost });
          writeConfig(config);
        }

        const target = localHost || 'localhost';
        console.log(chalk.gray(`  ${remotePort} -> ${target}:${localPort}`));
      } else if (res.status === 404) {
        console.log(chalk.yellow('代理映射不存在（管理服务器未运行）'));
      } else {
        const data = await res.json() as { error?: string };
        console.log(chalk.red(`添加失败: ${data.error || '未知错误'}`));
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// proxies remove 子命令
proxiesCmd.command('remove')
  .description('移除指定端口的代理映射')
  .argument('<port>', '远程端口号')
  .action(async (remotePort) => {
    const port = parseInt(remotePort, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      console.log(chalk.yellow('端口号无效：1024-65535'));
      return;
    }

    // 通过 API 删除
    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/proxies/${port}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        console.log(chalk.green(`端口 ${port} 的代理映射已移除`));

        // 更新本地配置文件
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
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// proxies clear 子命令
proxiesCmd.command('clear')
  .description('清空所有代理映射')
  .action(async () => {
    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/proxies`, {
        method: 'DELETE',
      });

      if (res.ok) {
        console.log(chalk.green('所有代理映射已清空'));

        // 更新本地配置文件
        const config = readConfig();
        if (config) {
          config.proxies = [];
          writeConfig(config);
        }
      } else {
        const data = await res.json() as { error?: string };
        console.log(chalk.red(`清空失败: ${data.error || '未知错误'}`));
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// ==================== config 命令 ====================

const configCmd = program.command('config')
  .description('管理配置')
  .argument('[command]', '子命令：get, set, list, edit', { default: 'list' });

// config get 子命令
configCmd.command('get')
  .description('获取配置项')
  .argument('<key>', '配置项名称 (如: serverUrl, token, reconnectInterval, maxReconnectAttempts)')
  .action(async (key) => {
    const config = readConfig();
    if (!config) {
      console.log(chalk.yellow('配置文件不存在'));
      return;
    }

    const value = (config as any)[key];
    if (value === undefined) {
      console.log(chalk.yellow(`配置项 "${key}" 不存在`));
      console.log(chalk.gray('可用配置项：serverUrl, token, reconnectInterval, maxReconnectAttempts, proxies'));
      return;
    }

    // 显示值
    if (typeof value === 'object') {
      console.log(chalk.green(`${key}:`));
      console.log(chalk.gray(JSON.stringify(value, null, 2)));
    } else {
      console.log(chalk.green(`${key}: ${value}`));
    }
  });

// config set 子命令
configCmd.command('set')
  .description('设置配置项')
  .argument('<key>', '配置项名称')
  .argument('<value>', '配置值')
  .action(async (key, value) => {
    // 读取现有配置
    const config = readConfig() || {};
    const oldValue = (config as any)[key];

    // 解析值
    let parsedValue: any = value;
    if (key === 'serverUrl' || key === 'token') {
      parsedValue = value;
    } else if (key === 'reconnectInterval' || key === 'maxReconnectAttempts') {
      parsedValue = parseInt(value, 10);
    } else if (key === 'proxies') {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        console.log(chalk.yellow('proxies 必须是有效的 JSON 数组'));
        return;
      }
    }

    // 更新配置
    (config as any)[key] = parsedValue;
    writeConfig(config as ClientConfig);

    if (oldValue !== undefined) {
      console.log(chalk.green(`已更新：${key}`));
      console.log(chalk.gray(`  旧值: ${typeof oldValue === 'object' ? JSON.stringify(oldValue) : oldValue}`));
      console.log(chalk.gray(`  新值: ${typeof parsedValue === 'object' ? JSON.stringify(parsedValue) : parsedValue}`));
    } else {
      console.log(chalk.green(`已设置：${key} = ${typeof parsedValue === 'object' ? JSON.stringify(parsedValue) : parsedValue}`));
    }
  });

// config list 子命令
configCmd.command('list')
  .description('列出所有配置项')
  .action(async () => {
    const config = readConfig();
    if (!config) {
      console.log(chalk.yellow('配置文件不存在'));
      return;
    }

    console.log(chalk.blue.bold('配置列表：'));
    console.log(`  ${chalk.cyan('serverUrl')}:     ${chalk.gray(config.serverUrl || '(未设置)')}`);
    console.log(`  ${chalk.cyan('token')}:         ${chalk.gray(config.token || '(未设置)')}`);
    console.log(`  ${chalk.cyan('proxies')}:       ${chalk.gray(`[${config.proxies?.map(p => `${p.remotePort}:${p.localPort}`).join(', ') || '(空)'}]`)}`);
    console.log(`  ${chalk.cyan('reconnectInterval')}: ${chalk.gray(config.reconnectInterval || 30000)}ms`);
    console.log(`  ${chalk.cyan('maxReconnectAttempts')}: ${chalk.gray(config.maxReconnectAttempts || 10)}`);
  });

// config edit 子命令
configCmd.command('edit')
  .description('编辑配置文件')
  .action(async () => {
    const editors = {
      win32: 'notepad',
      darwin: 'open -a TextEdit',
      linux: 'nano',
    };
    const editor = editors[platform() as keyof typeof editors] || 'vi';
    const configPath = CONFIG_FILE;

    console.log(chalk.gray(`打开配置文件：${configPath}`));
    console.log(chalk.gray(`使用编辑器：${editor}`));

    try {
      execSync(`${editor} "${configPath}"`, { stdio: 'ignore' });
    } catch (err: any) {
      console.log(chalk.yellow(`打开失败: ${err.message}`));
      console.log(chalk.gray(`请手动打开：`));
    }
  });

// ==================== forward 命令（正向穿透模式）====================

const forwardCmd = program.command('forward')
  .description('管理正向穿透代理（本地端口 -> 远程客户端端口）')
  .argument('[command]', '子命令：list, add, remove, clients, register', { default: 'list' });

// forward list 子命令
forwardCmd.command('list')
  .description('列出所有正向穿透代理')
  .action(async () => {
    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/forward/list`);
      if (!res.ok) {
        console.log(chalk.yellow('无法获取代理列表（客户端未运行或功能不可用）'));
        return;
      }
      const data = await res.json() as { proxies: Array<{ localPort: number; targetClientId: string; targetPort: number; enabled: boolean }> };
      const proxies = data.proxies || [];

      if (proxies.length === 0) {
        console.log(chalk.yellow('暂无正向穿透代理'));
        return;
      }

      console.log(chalk.blue.bold('正向穿透代理列表：'));
      for (const proxy of proxies) {
        const status = proxy.enabled ? chalk.green('●') : chalk.gray('○');
        console.log(`  ${status} 本地 :${proxy.localPort} → ${chalk.cyan(proxy.targetClientId)}:${proxy.targetPort}`);
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// forward add 子命令
forwardCmd.command('add')
  .description('添加正向穿透代理')
  .argument('<mapping>', '映射格式：localPort:remotePort:targetClientId (如: 8080:3000:clientB)')
  .action(async (mapping) => {
    const parts = mapping.split(':');
    if (parts.length !== 3) {
      console.log(chalk.yellow('参数格式错误，应为：localPort:remotePort:targetClientId'));
      console.log(chalk.gray('示例：8080:3000:clientB'));
      return;
    }

    const localPort = parseInt(parts[0], 10);
    const targetPort = parseInt(parts[1], 10);
    const targetClientId = parts[2];

    if (isNaN(localPort) || localPort < 1 || localPort > 65535) {
      console.log(chalk.yellow('本地端口无效：1-65535'));
      return;
    }
    if (isNaN(targetPort) || targetPort < 1 || targetPort > 65535) {
      console.log(chalk.yellow('目标端口无效：1-65535'));
      return;
    }
    if (!targetClientId || targetClientId.length === 0) {
      console.log(chalk.yellow('目标客户端 ID 不能为空'));
      return;
    }

    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/forward/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPort, targetClientId, targetPort }),
      });

      if (res.ok) {
        console.log(chalk.green('正向穿透代理已添加'));
        console.log(chalk.gray(`  本地 :${localPort} → ${targetClientId}:${targetPort}`));
      } else if (res.status === 404) {
        console.log(chalk.yellow('客户端未运行或功能不可用'));
      } else {
        const data = await res.json() as { error?: string };
        console.log(chalk.red(`添加失败: ${data.error || '未知错误'}`));
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// forward remove 子命令
forwardCmd.command('remove')
  .description('移除正向穿透代理')
  .argument('<localPort>', '本地端口号')
  .action(async (localPort) => {
    const port = parseInt(localPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      console.log(chalk.yellow('端口号无效：1-65535'));
      return;
    }

    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/forward/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localPort: port }),
      });

      if (res.ok) {
        console.log(chalk.green(`本地端口 ${port} 的正向穿透代理已移除`));
      } else {
        const data = await res.json() as { error?: string };
        console.log(chalk.red(`移除失败: ${data.error || '未知错误'}`));
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// forward clients 子命令
forwardCmd.command('clients')
  .description('查看在线客户端列表')
  .action(async () => {
    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/forward/clients`);
      if (!res.ok) {
        console.log(chalk.yellow('无法获取客户端列表'));
        return;
      }
      const data = await res.json() as { clients: Array<{ id: string; description?: string; registeredAt: number }> };
      const clients = data.clients || [];

      if (clients.length === 0) {
        console.log(chalk.yellow('暂无在线客户端'));
        return;
      }

      console.log(chalk.blue.bold('在线客户端列表：'));
      for (const client of clients) {
        const desc = client.description ? ` (${client.description})` : '';
        console.log(`  ${chalk.cyan(client.id)}${desc}`);
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// forward register 子命令
forwardCmd.command('register')
  .description('注册到服务器（启用正向穿透模式）')
  .option('-d, --description <desc>', '客户端描述')
  .action(async (options) => {
    try {
      const res = await fetch(`${ADMIN_URL}/_ctc/forward/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: options.description || '' }),
      });

      if (res.ok) {
        console.log(chalk.green('已注册到服务器，正向穿透模式已启用'));
      } else {
        const data = await res.json() as { error?: string };
        console.log(chalk.red(`注册失败: ${data.error || '未知错误'}`));
      }
    } catch (err: any) {
      console.log(chalk.red(`请求失败: ${err.message}`));
    }
  });

// ==================== boot 命令 ====================

const bootCmd = program.command('boot')
  .description('管理开机自启动')
  .argument('[command]', '子命令：enable, disable, status', { default: 'status' });

// boot status 子命令
bootCmd.command('status')
  .description('查看开机自启动状态')
  .action(async () => {
    const registered = isBootRegistered();
    const status = registered ? chalk.green('已启用') : chalk.yellow('未启用');
    console.log(chalk.blue('开机自启动状态：') + status);

    if (registered) {
      const info = readPidFile();
      if (info) {
        console.log(chalk.gray(`  启动文件将运行：${info.serverUrl}`));
      }
    }
  });

// boot enable 子命令
bootCmd.command('enable')
  .description('启用开机自启动')
  .action(async () => {
    const info = readPidFile();
    if (!info) {
      console.log(chalk.yellow('客户端未启动过，请先使用 start 命令启动'));
      return;
    }

    try {
      registerBoot({
        isServer: false,
        nodePath,
        scriptPath: indexPath,
        args: info.args || [],
      });
      console.log(chalk.green('已启用开机自启动'));
    } catch (err: any) {
      console.log(chalk.red(`启用失败: ${err.message}`));
    }
  });

// boot disable 子命令
bootCmd.command('disable')
  .description('禁用开机自启动')
  .action(async () => {
    try {
      unregisterBoot();
      console.log(chalk.green('已禁用开机自启动'));
    } catch (err: any) {
      console.log(chalk.red(`禁用失败: ${err.message}`));
    }
  });

// ==================== logs 命令 ====================

const logsCmd = program.command('logs')
  .description('查看或跟踪日志')
  .option('-f, --follow', '跟踪日志输出（类似 tail -f）')
  .action(async (options) => {
    if (!existsSync(LOG_FILE)) {
      console.log(chalk.yellow('日志文件不存在'));
      return;
    }

    if (options.follow) {
      console.log(chalk.blue('跟踪日志输出 (Ctrl+C 退出)...'));
      console.log(chalk.dim('---'));

      const logFd = openSync(LOG_FILE, 'r');
      const buffer = Buffer.alloc(1024);
      let pos = 0;

      const readLog = () => {
        try {
          const bytesRead = readSync(logFd, buffer, 0, buffer.length, pos);
          if (bytesRead > 0) {
            const content = buffer.toString('utf-8', 0, bytesRead);
            process.stdout.write(content);
            pos += bytesRead;
          }
        } catch {
          // ignore
        }
      };

      // 读取最新内容
      readLog();

      // 监控文件变化
      const watcher = () => {
        try {
          const stat = statSync(LOG_FILE);
          const newSize = stat.size;
          if (newSize > pos) {
            readLog();
          }
        } catch (err) {
          // ignore
        }
      };

      // 每秒检查一次
      const interval = setInterval(watcher, 1000);

      // 处理退出
      process.on('SIGINT', () => {
        clearInterval(interval);
        closeSync(logFd);
        process.stdout.write('\n');
        console.log(chalk.gray('\n--- 日志跟踪已结束'));
        process.exit(0);
      });
    } else {
      // 显示所有日志
      const content = readFileSync(LOG_FILE, 'utf-8');
      console.log(chalk.blue('最近日志：'));
      console.log(chalk.dim('---'));
      console.log(content.split('\n').slice(-30).join('\n'));
      console.log(chalk.dim('---'));
      console.log(chalk.gray(`(日志文件：${LOG_FILE})`));
    }
  });

// ==================== open 命令 ====================

const openCmd = program.command('open')
  .description('在浏览器中打开管理页面')
  .action(async () => {
    const adminPage = 'http://127.0.0.1:9001';
    const openCmd = platform() === 'win32' ? 'start' : 'open';
    console.log(chalk.gray(`打开管理页面: ${adminPage}`));
    try {
      execSync(`${openCmd} ${adminPage}`, { stdio: 'ignore' });
      console.log(chalk.green('管理页面已在浏览器中打开'));
    } catch (err: any) {
      console.log(chalk.yellow(`打开失败: ${err.message}`));
      console.log(chalk.gray(`请手动访问：${adminPage}`));
    }
  });

// ==================== 默认处理 ====================

// 当没有指定命令时显示帮助
program.action(() => {
  showHelp();
});

// 解析命令行参数
program.parse();
