import { Config } from './config';
import { ForwardServer } from './server';

/**
 * 导出核心类，供作为库使用时引用
 */
export { Config } from './config';
export { ForwardServer } from './server';
export { SessionManager } from './session-manager';
export type { ServerConfig } from '@zhuanfa/shared';

/**
 * 主入口（独立运行模式）
 */
async function main(): Promise<void> {
  console.log('Starting Zhuanfa Server...');

  // 加载配置（从用户目录 .zhuanfa/server.json 或命令行参数）
  const config = await Config.load();

  // 验证配置
  config.validate();

  console.log('Configuration loaded:');
  console.log(`  Control port: ${config.controlPort}`);
  console.log(`  Auth tokens: ${config.authTokens.length} configured`);
  console.log(`  Heartbeat interval: ${config.heartbeatInterval}ms`);
  console.log(`  Session timeout: ${config.sessionTimeout}ms`);

  // 创建并启动服务器
  const server = new ForwardServer(config);

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  // 启动服务器
  await server.start();
  console.log('Server started successfully');
}

// 检查是否作为主模块运行
if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
