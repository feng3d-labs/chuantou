import { Config } from './config.js';
import { Controller } from './controller.js';
import { ProxyManager } from './proxy-manager.js';
import * as path from 'path';

/**
 * 主入口
 */
async function main(): Promise<void> {
  console.log('Starting Zhuanfa Client...');

  // 加载配置
  const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'default.json');
  const config = await Config.fromFile(configPath);

  // 环境变量覆盖
  const envConfig = Config.fromEnv();
  Object.assign(config, envConfig);

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
    console.log('\\nReceived SIGINT, shutting down gracefully...');
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\\nReceived SIGTERM, shutting down gracefully...');
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

main().catch((error) => {
  console.error('Failed to start client:', error);
  process.exit(1);
});
