#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { request } from 'http';
import { request as httpsRequest } from 'https';
import { start, stop } from './index.js';

const PID_DIR = join(homedir(), '.chuantou');
const PID_FILE = join(PID_DIR, 'server.pid');

interface PidInfo {
  pid: number;
  host: string;
  controlPort: number;
  tls: boolean;
}

function writePidFile(info: PidInfo): void {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(info, null, 2));
}

function readPidFile(): PidInfo | null {
  try {
    const content = readFileSync(PID_FILE, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function removePidFile(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

function httpGet(host: string, port: number, path: string, tls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const doRequest = tls ? httpsRequest : request;
    const req = doRequest({ hostname: host === '0.0.0.0' ? '127.0.0.1' : host, port, path, method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

function httpPost(host: string, port: number, path: string, tls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const doRequest = tls ? httpsRequest : request;
    const req = doRequest({ hostname: host === '0.0.0.0' ? '127.0.0.1' : host, port, path, method: 'POST', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

const program = new Command();

program
  .name('chuantou-server')
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

    console.log(chalk.green('Server started successfully'));
    console.log(chalk.gray(`  Host: ${serverOptions.host}`));
    console.log(chalk.gray(`  Port: ${serverOptions.controlPort}`));
    console.log(chalk.gray(`  Tokens: ${serverOptions.authTokens.length} configured`));
    console.log(chalk.gray(`  TLS: ${tls ? 'enabled' : 'disabled'}`));

    const shutdown = async () => {
      console.log(chalk.yellow('\nShutting down...'));
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
      console.log(chalk.red('No running server found (PID file not found)'));
      process.exit(1);
    }

    try {
      const data = await httpGet(pidInfo.host, pidInfo.controlPort, '/_chuantou/status', pidInfo.tls);
      const status = JSON.parse(data);

      console.log(chalk.blue.bold('Chuantou Server Status'));
      console.log(chalk.gray(`  Running: ${status.running ? chalk.green('yes') : chalk.red('no')}`));
      console.log(chalk.gray(`  Host: ${status.host}:${status.controlPort}`));
      console.log(chalk.gray(`  TLS: ${status.tls ? 'enabled' : 'disabled'}`));
      console.log(chalk.gray(`  Uptime: ${Math.floor(status.uptime / 1000)}s`));
      console.log(chalk.gray(`  Clients: ${status.authenticatedClients}`));
      console.log(chalk.gray(`  Ports: ${status.totalPorts}`));
      console.log(chalk.gray(`  Connections: ${status.activeConnections}`));
    } catch {
      console.log(chalk.red('Failed to connect to server. It may not be running.'));
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
      console.log(chalk.red('No running server found (PID file not found)'));
      process.exit(1);
    }

    try {
      await httpPost(pidInfo.host, pidInfo.controlPort, '/_chuantou/stop', pidInfo.tls);
      removePidFile();
      console.log(chalk.green('Server stopped'));
    } catch {
      console.log(chalk.red('Failed to connect to server. It may not be running.'));
      removePidFile();
      process.exit(1);
    }
  });

program.parse();
