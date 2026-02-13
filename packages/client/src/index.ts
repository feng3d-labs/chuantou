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
import { IpcHandler } from './ipc-handler.js';
import { ProxyConfig, ProxyConfigWithIndex, logger } from '@feng3d/chuantou-shared';
import { join } from 'path';
import { homedir } from 'os';
import { ForwardProxy } from './forward-proxy.js';
import type { ForwardProxyEntry } from '@feng3d/chuantou-shared';

/**
 * 导出核心类和类型，供作为库使用时引用。
 */
export { Config } from './config.js';
export { Controller } from './controller.js';
export { ProxyManager } from './proxy-manager.js';
export { AdminServer } from './admin-server.js';
export { UnifiedHandler } from './handlers/unified-handler.js';
export { IpcHandler } from './ipc-handler.js';
export { ForwardProxy } from './forward-proxy.js';
export type { ClientConfig, ProxyConfig, ForwardProxyConfig } from '@feng3d/chuantou-shared';

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

  // 创建正向穿透代理
  const forwardProxy = new ForwardProxy(controller);

  // 已注册的代理配置列表（用于管理页面）
  const registeredProxies: ProxyConfigWithIndex[] = [];
  let nextProxyIndex = 1;
  for (const p of config.proxies) {
    registeredProxies.push({ ...p, index: nextProxyIndex++ });
  }

  // 创建管理页面服务器
  const adminServerConfig = { port: config.adminPort, host: '127.0.0.1' };

  // 获取状态回调
  const getStatusCallback = (): ClientStatus => {
    const status: ClientStatus = {
      running: true,
      serverUrl: config.serverUrl,
      connected: controller.isConnected(),
      authenticated: controller.isAuthenticated(),
      uptime: Date.now() - startTime,
      proxies: registeredProxies.map(p => ({ ...p })),
      reconnectAttempts: controller.getReconnectAttempts(),
    };

    // 添加正向穿透相关信息
    try {
      const forwardProxies = forwardProxy.getProxies();
      status.forwardProxies = forwardProxies;
      status.isRegistered = true; // 假设已注册（实际应从 Controller 获取）
      status.clientId = controller.getClientId();
    } catch (e) {
      // 如果获取失败，返回基础状态
    }

    return status;
  };

  // 添加代理回调
  const addProxyCallback = async (proxy: ProxyConfig): Promise<void> => {
    await proxyManager.registerProxy(proxy);
    registeredProxies.push({ ...proxy, index: nextProxyIndex++ });
  };

  // 删除代理回调
  const removeProxyCallback = async (remotePort: number): Promise<void> => {
    await proxyManager.unregisterProxy(remotePort);
    const index = registeredProxies.findIndex(p => p.remotePort === remotePort);
    if (index !== -1) {
      registeredProxies.splice(index, 1);
    }
  };

  // 添加正向穿透回调
  const addForwardProxyCallback = async (entry: ForwardProxyEntry): Promise<void> => {
    await forwardProxy.addProxy(entry);
  };

  // 删除正向穿透回调
  const removeForwardProxyCallback = async (localPort: number): Promise<void> => {
    await forwardProxy.removeProxy(localPort);
  };

  // 注册客户端回调
  const registerClientCallback = async (description?: string): Promise<void> => {
    return await forwardProxy.registerAsClient(description);
  };

  // 获取客户端列表回调
  const getClientListCallback = async (): Promise<any> => {
    return await forwardProxy.getClientList();
  };

  // 重连回调
  const reconnectCallback = async (): Promise<void> => {
    logger.log('收到手动重连请求');
    // 先断开现有连接
    controller.disconnect();
    // 然后重新连接
    await controller.connect();
  };

  // 创建管理页面服务器
  const adminServer = new AdminServer(
    adminServerConfig,
    getStatusCallback,
    addProxyCallback,
    removeProxyCallback,
    addForwardProxyCallback,
    removeForwardProxyCallback,
    registerClientCallback,
    getClientListCallback,
    undefined, // sendMessage 会在后面设置
    reconnectCallback
  );

  // 设置发送消息回调（用于正向穿透向服务端发送消息）
  adminServer.setSendMessageCallback(async (message: any) => {
    return await controller.sendRequest(message);
  });

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
  });

  // 设置 IPC 请求监听（用于处理 CLI 添加代理的请求）
  const ipcHandler = new IpcHandler({
    requestDir: join(homedir(), '.chuantou', 'proxy-requests'),
    controller,
    proxyManager,
    registeredProxies,
  });
  ipcHandler.start();

  // 启动管理页面服务器（立即启动，不等待认证）
  try {
    await adminServer.start();
  } catch (error) {
    logger.error('管理页面启动失败:', error);
  }

  // 优雅关闭
  const shutdown = async () => {
    ipcHandler.stop();
    logger.log('\n正在关闭...');
    await adminServer.stop();
    await proxyManager.destroy();
    controller.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // 未捕获异常处理 - 崩溃时记录退出码
  process.on('uncaughtException', (error) => {
    logger.error('未捕获异常:', error);
    // 写入非零退出码，让父进程知道是异常退出
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('未处理的 Promise 拒绝:', reason);
    // 写入非零退出码
    process.exit(1);
  });

  // 连接到服务器（不会抛出连接失败的异常，会自动重连）
  await controller.connect();
}

// 检查是否作为主模块运行
// 使用更简单的方式：通过检查是否直接运行此文件
const isMainModule = process.argv[1] && process.argv[1].endsWith('index.js');

if (isMainModule) {
  main().catch((error) => {
    logger.error('启动客户端失败:', error);
    // 注意：main() 内部已经处理了资源清理
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
