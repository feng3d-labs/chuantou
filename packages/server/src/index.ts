/**
 * @module index
 * @description 穿透服务端公共 API 入口模块。
 * 提供便捷的 start、status、stop 函数，以及核心类和类型的导出。
 * 外部使用者可直接通过此模块快速启动、查询和停止转发服务器。
 */

import { ServerConfig } from '@feng3d/chuantou-shared';
import { ForwardServer, ServerStatus } from './server.js';

export { ForwardServer } from './server.js';
export type { ServerStatus } from './server.js';
export { SessionManager } from './session-manager.js';
export type { ServerConfig } from '@feng3d/chuantou-shared';

/**
 * 启动转发服务器
 *
 * 创建一个 {@link ForwardServer} 实例并启动，是最常用的快捷启动方式。
 *
 * @param options - 可选的服务器配置项，未提供的字段将使用默认值
 * @returns 已启动的 {@link ForwardServer} 实例
 */
export async function start(options: Partial<ServerConfig> = {}): Promise<ForwardServer> {
  const server = new ForwardServer(options);
  await server.start();
  return server;
}

/**
 * 查询服务器状态
 *
 * 获取指定转发服务器的当前运行状态信息。
 *
 * @param server - 需要查询状态的 {@link ForwardServer} 实例
 * @returns 包含服务器运行状态的 {@link ServerStatus} 对象
 */
export function status(server: ForwardServer): ServerStatus {
  return server.getStatus();
}

/**
 * 停止服务器
 *
 * 优雅地停止指定的转发服务器，释放所有资源。
 *
 * @param server - 需要停止的 {@link ForwardServer} 实例
 * @returns 服务器完全停止后的 Promise
 */
export async function stop(server: ForwardServer): Promise<void> {
  await server.stop();
}
