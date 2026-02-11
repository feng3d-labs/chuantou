#!/usr/bin/env node
/**
 * Chuantou Server CLI
 * @feng3d/chuantou-server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { run } from './index.js';

const program = new Command();

program
  .name('chuantou-server')
  .description(chalk.blue('穿透内网穿透服务端'))
  .version('0.0.1')
  .option('-p, --port <port>', '控制端口', '9000')
  .option('-a, --host <address>', '监听地址', '0.0.0.0')
  .option('-t, --tokens <tokens>', '认证令牌（逗号分隔）', 'jidexiugaio')
  .option('-c, --config <path>', '配置文件路径')
  .option('--tls-key <path>', 'TLS 私钥文件路径（启用 HTTPS/WSS）')
  .option('--tls-cert <path>', 'TLS 证书文件路径（启用 HTTPS/WSS）')
  .option('--heartbeat-interval <ms>', '心跳间隔（毫秒）', '30000')
  .option('--session-timeout <ms>', '会话超时（毫秒）', '60000')
  .action(async (options) => {
    // 将命令行参数转换为环境变量，供 Config.load() 读取
    if (options.port) process.argv.push('--port', options.port);
    if (options.host) process.argv.push('--host', options.host);
    if (options.tokens) process.argv.push('--tokens', options.tokens);
    if (options.config) process.argv.push('--config', options.config);
    if (options.tlsKey) process.argv.push('--tls-key', options.tlsKey);
    if (options.tlsCert) process.argv.push('--tls-cert', options.tlsCert);

    // 运行主程序
    await run();
  });

program.parse();
