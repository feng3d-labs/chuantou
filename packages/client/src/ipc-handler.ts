/**
 * @module ipc-handler
 *
 * IPC 请求处理模块。
 *
 * 通过文件系统实现进程间通信（IPC），允许 CLI 向运行中的客户端进程
 * 发送添加代理请求。请求通过 JSON 文件传递，响应通过 .resp 文件返回。
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ProxyConfig, logger } from '@feng3d/chuantou-shared';
import { Controller } from './controller.js';
import { ProxyManager } from './proxy-manager.js';

/**
 * IPC 请求处理器，处理来自 CLI 的文件系统 IPC 请求。
 *
 * 通过定时扫描请求目录，发现新的请求文件后处理并写入响应文件。
 * 使用 processingFiles 集合防止同一请求被重复处理。
 */
export class IpcHandler {
  private processingFiles = new Set<string>();
  private requestDir: string;
  private controller: Controller;
  private proxyManager: ProxyManager;
  private registeredProxies: ProxyConfig[];
  private timer: NodeJS.Timeout | null = null;

  constructor(options: {
    requestDir: string;
    controller: Controller;
    proxyManager: ProxyManager;
    registeredProxies: ProxyConfig[];
  }) {
    this.requestDir = options.requestDir;
    this.controller = options.controller;
    this.proxyManager = options.proxyManager;
    this.registeredProxies = options.registeredProxies;
  }

  /**
   * 启动 IPC 请求监听，每 500ms 扫描一次请求目录。
   */
  start(): void {
    mkdirSync(this.requestDir, { recursive: true });
    this.timer = setInterval(() => this.checkRequests(), 500);
  }

  /**
   * 停止 IPC 请求监听。
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 扫描请求目录，处理新的请求文件。
   * 已在处理中的文件会被跳过，防止重复处理。
   */
  checkRequests(): void {
    try {
      const files = readdirSync(this.requestDir);
      for (const file of files) {
        if (file.endsWith('.json') && !this.processingFiles.has(file)) {
          this.processingFiles.add(file);
          const requestPath = join(this.requestDir, file);
          this.handleRequest(requestPath).finally(() => {
            this.processingFiles.delete(file);
          });
        }
      }
    } catch {
      // 忽略目录读取错误
    }
  }

  /**
   * 处理单个添加代理请求文件。
   *
   * 读取请求文件 → 检查认证状态 → 注册代理 → 写入响应文件。
   * 无论成功或失败，始终写入响应文件，确保 CLI 不会超时等待。
   */
  async handleRequest(requestFilePath: string): Promise<void> {
    const responsePath = requestFilePath.replace('.json', '.resp');
    try {
      const requestData = JSON.parse(readFileSync(requestFilePath, 'utf-8'));
      if (requestData.type !== 'add-proxy') return;

      const proxy: ProxyConfig = requestData.proxy;

      logger.log(`收到添加代理请求: :${proxy.remotePort} -> ${proxy.localHost || 'localhost'}:${proxy.localPort}`);

      // 检查控制器是否已认证
      if (!this.controller.isAuthenticated()) {
        writeFileSync(responsePath, JSON.stringify({ success: false, error: '客户端未连接到服务器，请稍后重试' }));
        return;
      }

      try {
        await this.proxyManager.registerProxy(proxy);
        this.registeredProxies.push({ ...proxy });

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
      // 确保即使在外层异常时也写入响应文件，避免 CLI 超时
      try {
        const errorMessage = error instanceof Error ? error.message : String(error);
        writeFileSync(responsePath, JSON.stringify({ success: false, error: errorMessage }));
      } catch {
        // 无法写入响应文件 - 忽略
      }
    }
  }
}
