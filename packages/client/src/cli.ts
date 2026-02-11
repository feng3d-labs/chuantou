#!/usr/bin/env node
/**
 * @module cli
 *
 * 穿透（Chuantou）内网穿透客户端命令行界面模块。
 *
 * 基于 commander 库实现命令行参数解析，提供以下选项：
 * - `-s, --server <url>` - 服务器 WebSocket 地址
 * - `-t, --token <token>` - 认证令牌
 * - `-p, --proxies <proxies>` - 代理配置字符串
 * - `-c, --config <path>` - 配置文件路径
 * - `--reconnect-interval <ms>` - 重连间隔时间
 * - `--max-reconnect <number>` - 最大重连次数
 *
 * 解析后的参数会被追加到 `process.argv` 中，供 {@link Config.load} 方法读取。
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { run } from './index.js';

/** Commander 程序实例 */
const program = new Command();

program
  .name('chuantou-client')
  .description(chalk.green('穿透内网穿透客户端'))
  .version('0.0.1')
  .option('-s, --server <url>', '服务器地址 (如 ws://localhost:9000)', 'ws://localhost:9000')
  .option('-t, --token <token>', '认证令牌', 'jidexiugaio')
  .option('-p, --proxies <proxies>', '代理配置 (格式: remotePort:protocol:localPort:localHost,...)', '8080:http:3000:localhost,8081:ws:3001')
  .option('-c, --config <path>', '配置文件路径')
  .option('--reconnect-interval <ms>', '重连间隔（毫秒）', '5000')
  .option('--max-reconnect <number>', '最大重连次数', '10')
  .action(async (options) => {
    // 将命令行参数转换为 process.argv 格式，供 Config.load() 读取
    if (options.server) process.argv.push('--server', options.server);
    if (options.token) process.argv.push('--token', options.token);
    if (options.proxies) process.argv.push('--proxies', options.proxies);
    if (options.config) process.argv.push('--config', options.config);

    // 运行主程序
    await run();
  });

program.parse();
