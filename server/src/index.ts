import { Config } from './config.js';
import { ForwardServer } from './server.js';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * 主入口
 */
async function main(): Promise<void> {
  console.log('Starting Zhuanfa Server...');

  // 加载配置
  const configPath = process.env.CONFIG_PATH || path.join(process.cwd(), 'config', 'default.json');
  const config = await Config.fromFile(configPath);

  // 环境变量覆盖
  const envConfig = Config.fromEnv();
  Object.assign(config, envConfig);

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
    console.log('\\nReceived SIGINT, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\\nReceived SIGTERM, shutting down gracefully...');
    await server.stop();
    process.exit(0);
  });

  // 启动服务器
  await server.start();
  console.log('Server started successfully');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
