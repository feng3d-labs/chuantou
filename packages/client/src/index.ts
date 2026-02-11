/**
 * @module @feng3d/chuantou-client
 *
 * 穿透（Chuantou）内网穿透客户端主入口模块。
 *
 * 该模块提供了客户端的核心功能导出和独立运行入口。
 * 作为库使用时，可以导入 {@link Config}、{@link Controller}、{@link ProxyManager} 等核心类；
 * 作为独立程序运行时，会自动加载配置、连接服务器并注册代理隧道。
 */

import { Config } from './config.js';
import { Controller } from './controller.js';
import { ProxyManager } from './proxy-manager.js';

/**
 * 导出核心类和类型，供作为库使用时引用。
 */
export { Config } from './config.js';
export { Controller } from './controller.js';
export { ProxyManager } from './proxy-manager.js';
export { HttpHandler } from './handlers/http-handler.js';
export { WsHandler } from './handlers/ws-handler.js';
export type { ClientConfig, ProxyConfig } from '@feng3d/chuantou-shared';

/**
 * 客户端主入口函数（独立运行模式）。
 *
 * 执行以下步骤：
 * 1. 从配置文件或命令行参数加载配置
 * 2. 验证配置合法性
 * 3. 创建控制器并连接服务器
 * 4. 认证成功后注册所有代理隧道
 * 5. 监听进程信号实现优雅关闭
 *
 * @returns 无返回值的 Promise
 */
async function main(): Promise<void> {
  console.log('正在启动穿透客户端...');

  // 加载配置（从用户目录 .chuantou/client.json 或命令行参数）
  const config = await Config.load();

  // 验证配置
  config.validate();

  console.log('配置已加载:');
  console.log(`  服务器地址: ${config.serverUrl}`);
  console.log(`  代理数量: 已配置 ${config.proxies.length} 个`);
  for (const proxy of config.proxies) {
    console.log(`    - ${proxy.protocol} :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`);
  }

  // 创建控制器
  const controller = new Controller(config);

  // 创建代理管理器
  const proxyManager = new ProxyManager(controller);

  // 监听控制器事件
  controller.on('connected', () => {
    console.log('已连接到服务器');
  });

  controller.on('disconnected', () => {
    console.log('已断开与服务器的连接');
  });

  controller.on('authenticated', async () => {
    console.log('已认证，正在注册代理...');

    // 注册所有代理
    for (const proxyConfig of config.proxies) {
      try {
        await proxyManager.registerProxy(proxyConfig);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`注册代理失败: ${errorMessage}`);
      }
    }
  });

  controller.on('maxReconnectAttemptsReached', () => {
    console.error('已达到最大重连次数，正在退出...');
    process.exit(1);
  });

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\n收到 SIGINT 信号，正在优雅关闭...');
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n收到 SIGTERM 信号，正在优雅关闭...');
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  });

  // 连接到服务器
  try {
    await controller.connect();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('连接服务器失败:', errorMessage);
    process.exit(1);
  }
}

// 检查是否作为主模块运行
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (isMainModule) {
  main().catch((error) => {
    console.error('启动客户端失败:', error);
    process.exit(1);
  });
}

/**
 * 导出运行函数供 CLI 使用。
 *
 * 该函数是 {@link main} 的公开包装，用于被 CLI 模块调用以启动客户端。
 *
 * @returns 无返回值的 Promise
 */
export async function run(): Promise<void> {
  return main();
}
