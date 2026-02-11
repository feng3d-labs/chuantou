/**
 * @module proxy-manager
 *
 * 代理管理器模块。
 *
 * 负责管理所有代理隧道的生命周期，包括向服务器注册/注销代理、
 * 创建统一的处理器（同时支持 HTTP 和 WebSocket）、
 * 以及在连接断开时清理所有处理器。
 */

import { EventEmitter } from 'events';
import { Controller } from './controller.js';
import { ProxyConfig, logger, ProxyProtocol } from '@feng3d/chuantou-shared';
import { UnifiedHandler } from './handlers/unified-handler.js';
import { TcpHandler } from './handlers/tcp-handler.js';
import { MessageType, createMessage, RegisterMessage, UnregisterMessage, RegisterRespMessage } from '@feng3d/chuantou-shared';

/**
 * 代理处理器基类接口
 */
interface BaseHandler extends EventEmitter {
  destroy(): void;
}

/**
 * 代理管理器类，负责管理所有代理隧道的注册、注销和生命周期。
 *
 * 根据协议类型创建相应的处理器：
 * - HTTP 协议：创建 UnifiedHandler（同时支持 HTTP 和 WebSocket）
 * - TCP 协议：创建 TcpHandler（支持 SSH、MySQL 等原始 TCP 连接）
 *
 * 当控制器连接断开时，自动清理所有处理器。
 *
 * @example
 * ```typescript
 * const proxyManager = new ProxyManager(controller);
 * await proxyManager.registerProxy({ remotePort: 8080, localPort: 3000, protocol: 'http' });
 * await proxyManager.registerProxy({ remotePort: 2222, localPort: 22, protocol: 'tcp' });
 * ```
 */
export class ProxyManager extends EventEmitter {
  /** 控制器实例，用于与服务器通信 */
  private controller: Controller;

  /** 代理处理器映射表，键为远程端口号，值为对应的处理器实例 */
  private handlers: Map<number, BaseHandler>;

  /**
   * 创建代理管理器实例。
   *
   * @param controller - 控制器实例，用于与服务器进行通信
   */
  constructor(controller: Controller) {
    super();
    this.controller = controller;
    this.handlers = new Map();

    // 监听控制器事件
    this.controller.on('disconnected', () => {
      this.onDisconnected();
    });
  }

  /**
   * 向服务器注册一个代理隧道。
   *
   * 发送注册消息到服务器，注册成功后根据协议类型创建相应的处理器：
   * - HTTP 协议：创建 UnifiedHandler（同时支持 HTTP 和 WebSocket）
   * - TCP 协议：创建 TcpHandler（支持 SSH、MySQL 等原始 TCP 连接）
   *
   * @param config - 代理配置对象，包含远程端口、本地端口、协议类型等信息
   * @throws {Error} 注册失败时抛出错误，包含服务器返回的错误信息
   */
  async registerProxy(config: ProxyConfig): Promise<void> {
    const protocol: ProxyProtocol = config.protocol || 'http';
    const protocolLabel = config.protocol ? protocol.toUpperCase() : 'HTTP + WebSocket + TCP';
    logger.log(`正在注册 ${protocolLabel} 代理: :${config.remotePort} -> ${config.localHost || 'localhost'}:${config.localPort}`);

    // 发送注册消息（如果未指定 protocol，则发送 'http' 作为默认值）
    const registerMsg: RegisterMessage = createMessage(MessageType.REGISTER, {
      remotePort: config.remotePort,
      localPort: config.localPort,
      localHost: config.localHost,
      protocol,
    });

    const response = await this.controller.sendRequest<RegisterRespMessage>(registerMsg);

    if (!response.payload.success) {
      throw new Error(`注册代理失败: ${response.payload.error}`);
    }

    logger.log(`代理已注册: ${response.payload.remoteUrl}`);

    // 根据协议类型创建相应的处理器
    const handler = protocol === 'tcp'
      ? new TcpHandler(this.controller, config)
      : new UnifiedHandler(this.controller, config);

    // 设置处理器事件
    handler.on('error', (error) => {
      logger.error(`端口 ${config.remotePort} 的处理器错误:`, error);
    });

    this.handlers.set(config.remotePort, handler);
    this.emit('handlerCreated', config.remotePort, protocol);
  }

  /**
   * 注销指定远程端口的代理隧道。
   *
   * 销毁对应的处理器，并向服务器发送注销请求。
   *
   * @param remotePort - 要注销的代理对应的远程端口号
   */
  async unregisterProxy(remotePort: number): Promise<void> {
    const handler = this.handlers.get(remotePort);
    if (handler) {
      handler.destroy();
      this.handlers.delete(remotePort);
    }

    const unregisterMsg: UnregisterMessage = createMessage(MessageType.UNREGISTER, {
      remotePort,
    });

    await this.controller.sendRequest(unregisterMsg);
    logger.log(`代理已注销: 端口 ${remotePort}`);
  }

  /**
   * 注销所有已注册的代理隧道。
   *
   * 并行注销所有代理，等待全部注销完成后返回。
   *
   * @returns 所有代理注销完成后解析的 Promise
   */
  async unregisterAll(): Promise<void> {
    const unregisterPromises: Promise<void>[] = [];
    for (const port of this.handlers.keys()) {
      unregisterPromises.push(this.unregisterProxy(port));
    }
    await Promise.all(unregisterPromises);
  }

  /**
   * 处理控制器连接断开事件。
   *
   * 销毁所有处理器并清空处理器映射表。
   */
  private onDisconnected(): void {
    logger.log('连接丢失，正在停止所有处理器...');
    for (const handler of this.handlers.values()) {
      handler.destroy();
    }
    this.handlers.clear();
  }

  /**
   * 销毁代理管理器，注销所有代理并释放资源。
   *
   * @returns 销毁完成后解析的 Promise
   */
  async destroy(): Promise<void> {
    await this.unregisterAll();
  }
}
