/**
 * @module @feng3d/ctc
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
import { AdminServer, ClientStatus } from './admin-server.js';
import { ProxyConfig, logger } from '@feng3d/chuantou-shared';
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * 导出核心类和类型，供作为库使用时引用。
 */
export { Config } from './config.js';
export { Controller } from './controller.js';
export { ProxyManager } from './proxy-manager.js';
export { AdminServer } from './admin-server.js';
export { UnifiedHandler } from './handlers/unified-handler.js';
export type { ClientConfig, ProxyConfig } from '@feng3d/chuantou-shared';

/**
 * 客户端主入口函数（独立运行模式）。
 *
 * 执行以下步骤：
 * 1. 从配置文件或命令行参数加载配置
 * 2. 验证配置合法性
 * 3. 创建控制器并连接服务器
 * 4. 认证成功后注册所有代理隧道
 * 5. 启动本地 HTTP 管理页面服务器
 * 6. 监听进程信号实现优雅关闭
 *
 * @returns 无返回值的 Promise
 */
async function main(): Promise<void> {
  logger.log('正在启动穿透客户端...');

  // 加载配置（从用户目录 .chuantou/client.json 或命令行参数）
  const config = await Config.load();

  // 验证配置
  config.validate();

  logger.log('配置已加载:');
  logger.log(`  服务器地址: ${config.serverUrl}`);
  logger.log(`  代理数量: 已配置 ${config.proxies.length} 个`);
  for (const proxy of config.proxies) {
    logger.log(`    - :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`);
  }

  // 记录启动时间
  const startTime = Date.now();

  // 创建控制器
  const controller = new Controller(config);

  // 创建代理管理器
  const proxyManager = new ProxyManager(controller);

  // 已注册的代理配置列表（用于管理页面）
  const registeredProxies: ProxyConfig[] = [];
  for (const p of config.proxies) {
    registeredProxies.push({ ...p });
  }

  // 创建管理页面服务器
  const adminServer = new AdminServer(
    { port: 9001, host: '127.0.0.1' },
    // 获取状态回调
    (): ClientStatus => ({
      running: true,
      serverUrl: config.serverUrl,
      connected: controller.isConnected(),
      authenticated: controller.isAuthenticated(),
      uptime: Date.now() - startTime,
      proxies: registeredProxies.map(p => ({ ...p })),
      reconnectAttempts: controller.getReconnectAttempts(),
    }),
    // 添加代理回调
    async (proxy: ProxyConfig): Promise<void> => {
      await proxyManager.registerProxy(proxy);
      registeredProxies.push({ ...proxy });
    },
    // 删除代理回调
    async (remotePort: number): Promise<void> => {
      await proxyManager.unregisterProxy(remotePort);
      const index = registeredProxies.findIndex(p => p.remotePort === remotePort);
      if (index !== -1) {
        registeredProxies.splice(index, 1);
      }
    }
  );

  // 监听控制器事件
  controller.on('connected', () => {
    logger.log('已连接到服务器');
  });

  controller.on('disconnected', () => {
    logger.log('已断开与服务器的连接');
  });

  controller.on('authenticated', async () => {
    logger.log('已认证，正在注册代理...');

    // 注册所有代理
    for (const proxyConfig of config.proxies) {
      try {
        await proxyManager.registerProxy(proxyConfig);
        // 代理配置已在初始化时添加到 registeredProxies
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`注册代理失败: ${errorMessage}`);
      }
    }

    // 启动管理页面服务器
    try {
      await adminServer.start();
    } catch (error) {
      logger.error('管理页面启动失败:', error);
    }
  });

  controller.on('maxReconnectAttemptsReached', () => {
    logger.error('已达到最大重连次数，正在退出...');
    process.exit(1);
  });

  // 设置 IPC 请求监听（用于处理 CLI 添加代理的请求）
  const requestDir = join(homedir(), '.chuantou', 'proxy-requests');
  mkdirSync(requestDir, { recursive: true });

  // 处理添加代理请求的函数
  const handleAddProxyRequest = async (requestFilePath: string) => {
    try {
      const requestData = JSON.parse(readFileSync(requestFilePath, 'utf-8'));
      if (requestData.type !== 'add-proxy') return;

      const proxy: ProxyConfig = requestData.proxy;
      const responsePath = requestFilePath.replace('.json', '.resp');

      logger.log(`收到添加代理请求: :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`);

      try {
        await proxyManager.registerProxy(proxy);
        registeredProxies.push({ ...proxy });

        // 写入成功响应
        writeFileSync(responsePath, JSON.stringify({ success: true }));
        logger.log(`代理已通过 IPC 添加: :${proxy.remotePort}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`通过 IPC 添加代理失败: ${errorMessage}`);
        // 写入失败响应
        writeFileSync(responsePath, JSON.stringify({ success: false, error: errorMessage }));
      }
    } catch (error) {
      logger.error('处理添加代理请求时出错:', error);
    }
  };

  // 定期检查新的请求文件
  const requestChecker = setInterval(() => {
    try {
      const files = readdirSync(requestDir);
      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.resp')) {
          const requestPath = join(requestDir, file);
          handleAddProxyRequest(requestPath);
        }
      }
    } catch (error) {
      // 忽略错误
    }
  }, 500); // 每 500ms 检查一次

  // 优雅关闭
  const shutdown = async () => {
    clearInterval(requestChecker);
    logger.log('\n正在关闭...');
    await adminServer.stop();
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 连接到服务器
  try {
    await controller.connect();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('连接服务器失败:', errorMessage);
    process.exit(1);
  }
}

// 检查是否作为主模块运行
const isMainModule = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`;

if (isMainModule) {
  main().catch((error) => {
    logger.error('启动客户端失败:', error);
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
