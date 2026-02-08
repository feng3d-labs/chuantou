import { Config } from './config';
import { Controller } from './controller';
import { ProxyManager } from './proxy-manager';

/**
 * 导出核心类，供作为库使用时引用
 */
export { Config } from './config';
export { Controller } from './controller';
export { ProxyManager } from './proxy-manager';
export { HttpHandler } from './handlers/http-handler';
export { WsHandler } from './handlers/ws-handler';
export type { ClientConfig, ProxyConfig } from '@zhuanfa/shared';

/**
 * 主入口（独立运行模式）
 */
async function main(): Promise<void> {
  console.log('Starting Zhuanfa Client...');

  // 加载配置（从用户目录 .zhuanfa/client.json 或命令行参数）
  const config = await Config.load();

  // 验证配置
  config.validate();

  console.log('Configuration loaded:');
  console.log(`  Server URL: ${config.serverUrl}`);
  console.log(`  Proxies: ${config.proxies.length} configured`);
  for (const proxy of config.proxies) {
    console.log(`    - ${proxy.protocol} :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`);
  }

  // 创建控制器
  const controller = new Controller(config);

  // 创建代理管理器
  const proxyManager = new ProxyManager(controller);

  // 监听控制器事件
  controller.on('connected', () => {
    console.log('Connected to server');
  });

  controller.on('disconnected', () => {
    console.log('Disconnected from server');
  });

  controller.on('authenticated', async () => {
    console.log('Authenticated, registering proxies...');

    // 注册所有代理
    for (const proxyConfig of config.proxies) {
      try {
        await proxyManager.registerProxy(proxyConfig);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Failed to register proxy: ${errorMessage}`);
      }
    }
  });

  controller.on('maxReconnectAttemptsReached', () => {
    console.error('Max reconnect attempts reached, exiting...');
    process.exit(1);
  });

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  });

  // 连接到服务器
  try {
    await controller.connect();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Failed to connect to server:', errorMessage);
    process.exit(1);
  }
}

// 检查是否作为主模块运行
if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start client:', error);
    process.exit(1);
  });
}
