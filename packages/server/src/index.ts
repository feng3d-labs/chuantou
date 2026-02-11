import { ServerConfig } from '@feng3d/chuantou-shared';
import { ForwardServer, ServerStatus } from './server.js';

export { ForwardServer } from './server.js';
export type { ServerStatus } from './server.js';
export { SessionManager } from './session-manager.js';
export type { ServerConfig } from '@feng3d/chuantou-shared';

/**
 * 启动服务器
 */
export async function start(options: Partial<ServerConfig> = {}): Promise<ForwardServer> {
  const server = new ForwardServer(options);
  await server.start();
  return server;
}

/**
 * 查询服务器状态
 */
export function status(server: ForwardServer): ServerStatus {
  return server.getStatus();
}

/**
 * 停止服务器
 */
export async function stop(server: ForwardServer): Promise<void> {
  await server.stop();
}
