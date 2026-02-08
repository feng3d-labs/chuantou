#!/usr/bin/env node
/**
 * Zhuanfa Server CLI
 * @feng3d/zhuanfa-server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import path from 'path';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('zhuanfa-server')
  .description(chalk.blue('Zhuanfa 内网穿透服务端'))
  .version('0.0.1')
  .option('-p, --port <port>', '控制端口', '9000')
  .option('-h, --host <address>', '监听地址', '0.0.0.0')
  .option('-t, --tokens <tokens>', '认证令牌（逗号分隔）', 'jidexiugaio')
  .option('-c, --config <path>', '配置文件路径')
  .option('--heartbeat-interval <ms>', '心跳间隔（毫秒）', '30000')
  .option('--session-timeout <ms>', '会话超时（毫秒）', '60000')
  .action((options) => {
    // 将命令行参数转换为环境变量，供 Config.load() 读取
    if (options.port) process.argv.push('--port', options.port);
    if (options.host) process.argv.push('--host', options.host);
    if (options.tokens) process.argv.push('--tokens', options.tokens);
    if (options.config) process.argv.push('--config', options.config);

    // 直接引入编译后的入口文件
    require(path.join(__dirname, '../dist/index.js'));
  });

program.parse();
