#!/usr/bin/env node

/**
 * @module cli
 * @description 穿透服务端命令行工具模块。
 * 提供 `feng3d-cts` CLI 命令，支持通过命令行启动、停止和查询转发服务器状态。
 * 使用 PID 文件跟踪运行中的服务器实例，以实现跨进程的状态管理。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { request } from 'http';
import { request as httpsRequest } from 'https';
import { start, stop } from './index.js';

/** PID 文件存放目录路径 */
const PID_DIR = join(homedir(), '.chuantou');
/** PID 文件完整路径 */
const PID_FILE = join(PID_DIR, 'server.pid');

/**
 * PID 文件信息接口
 *
 * 描述存储在 PID 文件中的服务器进程信息，用于跨进程查询和管理服务器。
 */
interface PidInfo {
  /** 服务器进程 ID */
  pid: number;
  /** 服务器监听的主机地址 */
  host: string;
  /** 控制通道端口号 */
  controlPort: number;
  /** 是否启用了 TLS 加密 */
  tls: boolean;
}

/**
 * 写入 PID 文件
 *
 * 将服务器进程信息写入 PID 文件，若目录不存在则自动创建。
 *
 * @param info - 需要写入的服务器进程信息
 */
function writePidFile(info: PidInfo): void {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

/**
 * 读取 PID 文件
 *
 * 从磁盘读取并解析 PID 文件内容，获取运行中服务器的进程信息。
 *
 * @returns 解析后的 {@link PidInfo} 对象；若文件不存在或解析失败则返回 `null`
 */
function readPidFile(): PidInfo | null {
  try {
    const content = readFileSync(PID_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 删除 PID 文件
 *
 * 移除磁盘上的 PID 文件。若文件不存在则静默忽略。
 */
function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

/**
 * 发送 HTTP GET 请求
 *
 * 向指定地址发送 GET 请求并返回响应内容。支持 HTTP 和 HTTPS。
 * 当 host 为 `0.0.0.0` 时自动替换为 `127.0.0.1`。
 *
 * @param host - 目标主机地址
 * @param port - 目标端口号
 * @param path - 请求路径
 * @param tls - 是否使用 HTTPS
 * @returns 响应体字符串内容
 */
function httpGet(host: string, port: number, path: string, tls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const doRequest = tls ? httpsRequest : request;
    const req = doRequest({ hostname: host === '0.0.0.0' ? '127.0.0.1' : host, port, path, method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

/**
 * 发送 HTTP POST 请求
 *
 * 向指定地址发送 POST 请求并返回响应内容。支持 HTTP 和 HTTPS。
 * 当 host 为 `0.0.0.0` 时自动替换为 `127.0.0.1`。
 *
 * @param host - 目标主机地址
 * @param port - 目标端口号
 * @param path - 请求路径
 * @param tls - 是否使用 HTTPS
 * @returns 响应体字符串内容
 */
function httpPost(host: string, port: number, path: string, tls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const doRequest = tls ? httpsRequest : request;
    const req = doRequest({ hostname: host === '0.0.0.0' ? '127.0.0.1' : host, port, path, method: 'POST', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

const program = new Command();

program
  .name('feng3d-cts')
  .description(chalk.blue('穿透 - 内网穿透服务端'))
  .version('0.0.5');

program
  .command('start')
  .description('启动服务器')
  .option('-p, --port <port>', '控制端口', '9000')
  .option('-a, --host <address>', '监听地址', '0.0.0.0')
  .option('-t, --tokens <tokens>', '认证令牌（逗号分隔）')
  .option('--tls-key <path>', 'TLS 私钥文件路径')
  .option('--tls-cert <path>', 'TLS 证书文件路径')
  .option('--heartbeat-interval <ms>', '心跳间隔（毫秒）', '30000')
  .option('--session-timeout <ms>', '会话超时（毫秒）', '60000')
  .action(async (options) => {
    const tls = (options.tlsKey && options.tlsCert)
      ? { key: readFileSync(options.tlsKey, 'utf-8'), cert: readFileSync(options.tlsCert, 'utf-8') }
      : undefined;

    const serverOptions = {
      host: options.host,
      controlPort: parseInt(options.port, 10),
      authTokens: options.tokens ? options.tokens.split(',') : [],
      heartbeatInterval: parseInt(options.heartbeatInterval, 10),
      sessionTimeout: parseInt(options.sessionTimeout, 10),
      tls,
    };

    const server = await start(serverOptions);

    writePidFile({
      pid: process.pid,
      host: serverOptions.host,
      controlPort: serverOptions.controlPort,
      tls: tls !== undefined,
    });

    console.log(chalk.green('服务器启动成功'));
    console.log(chalk.gray(`  主机: ${serverOptions.host}`));
    console.log(chalk.gray(`  端口: ${serverOptions.controlPort}`));
    console.log(chalk.gray(`  令牌: 已配置 ${serverOptions.authTokens.length} 个`));
    console.log(chalk.gray(`  TLS: ${tls ? '已启用' : '已禁用'}`));

    const shutdown = async () => {
      console.log(chalk.yellow('\n正在关闭...'));
      await stop(server);
      removePidFile();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('status')
  .description('查询服务器状态')
  .action(async () => {
    const pidInfo = readPidFile();
    if (!pidInfo) {
      console.log(chalk.red('未找到正在运行的服务器（PID 文件不存在）'));
      process.exit(1);
    }

    try {
      const data = await httpGet(pidInfo.host, pidInfo.controlPort, '/_chuantou/status', pidInfo.tls);
      const status = JSON.parse(data);

      console.log(chalk.blue.bold('穿透服务器状态'));
      console.log(chalk.gray(`  运行中: ${status.running ? chalk.green('是') : chalk.red('否')}`));
      console.log(chalk.gray(`  主机: ${status.host}:${status.controlPort}`));
      console.log(chalk.gray(`  TLS: ${status.tls ? '已启用' : '已禁用'}`));
      console.log(chalk.gray(`  运行时长: ${Math.floor(status.uptime / 1000)}秒`));
      console.log(chalk.gray(`  客户端: ${status.authenticatedClients}`));
      console.log(chalk.gray(`  端口: ${status.totalPorts}`));
      console.log(chalk.gray(`  连接数: ${status.activeConnections}`));
    } catch {
      console.log(chalk.red('无法连接到服务器，服务器可能未在运行。'));
      removePidFile();
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('停止服务器')
  .action(async () => {
    const pidInfo = readPidFile();
    if (!pidInfo) {
      console.log(chalk.red('未找到正在运行的服务器（PID 文件不存在）'));
      process.exit(1);
    }

    try {
      await httpPost(pidInfo.host, pidInfo.controlPort, '/_chuantou/stop', pidInfo.tls);
      removePidFile();
      console.log(chalk.green('服务器已停止'));
    } catch {
      console.log(chalk.red('无法连接到服务器，服务器可能未在运行。'));
      removePidFile();
      process.exit(1);
    }
  });

program.parse();
