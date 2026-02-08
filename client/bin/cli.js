#!/usr/bin/env node
/**
 * Zhuanfa Client CLI
 * @feng3d/zhuanfa-client
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
  .name('zhuanfa-client')
  .description(chalk.green('Zhuanfa 内网穿透客户端'))
  .version('0.0.1')
  .option('-s, --server <url>', '服务器地址 (如 ws://localhost:9000)', 'ws://localhost:9000')
  .option('-t, --token <token>', '认证令牌', 'jidexiugaio')
  .option('-p, --proxies <proxies>', '代理配置 (格式: remotePort:protocol:localPort:localHost,...)', '8080:http:3000:localhost,8081:ws:3001')
  .option('-c, --config <path>', '配置文件路径')
  .option('--reconnect-interval <ms>', '重连间隔（毫秒）', '5000')
  .option('--max-reconnect <number>', '最大重连次数', '10')
  .action((options) => {
    // 将命令行参数转换为环境变量，供 Config.load() 读取
    if (options.server) process.argv.push('--server', options.server);
    if (options.token) process.argv.push('--token', options.token);
    if (options.proxies) process.argv.push('--proxies', options.proxies);
    if (options.config) process.argv.push('--config', options.config);

    // 直接引入编译后的入口文件
    require(path.join(__dirname, '../dist/index.js'));
  });

program.parse();
