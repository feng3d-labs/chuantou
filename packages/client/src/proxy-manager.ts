/**
 * @module proxy-manager
 *
 * 代理管理器模块。
 *
 * 负责管理所有代理隧道的生命周期，包括向服务器注册/注销代理、
 * 根据协议类型创建对应的处理器（HTTP 或 WebSocket），
 * 以及在连接断开时清理所有处理器。
 */

import { Controller } from './controller.js';
import { ProxyConfig } from '@feng3d/chuantou-shared';
import { HttpHandler } from './handlers/http-handler.js';
import { WsHandler } from './handlers/ws-handler.js';
import { MessageType, createMessage, RegisterMessage, UnregisterMessage, RegisterRespMessage } from '@feng3d/chuantou-shared';

/**
 * 代理管理器类，负责管理所有代理隧道的注册、注销和生命周期。
 *
 * 根据代理配置的协议类型（HTTP 或 WebSocket），创建并维护对应的处理器实例。
 * 当控制器连接断开时，自动清理所有处理器。
 *
 * @example
 * ```typescript
 * const proxyManager = new ProxyManager(controller);
 * await proxyManager.registerProxy({ remotePort: 8080, protocol: 'http', localPort: 3000 });
 * ```
 */
export class ProxyManager {
  /** 控制器实例，用于与服务器通信 */
  private controller: Controller;

  /** 代理处理器映射表，键为远程端口号，值为对应的处理器实例 */
  private handlers: Map<number, HttpHandler | WsHandler>;

  /**
   * 创建代理管理器实例。
   *
   * @param controller - 控制器实例，用于与服务器进行通信
   */
  constructor(controller: Controller) {
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
   * 发送注册消息到服务器，注册成功后根据协议类型创建对应的处理器
   * （{@link HttpHandler} 或 {@link WsHandler}）并存储到处理器映射表中。
   *
   * @param config - 代理配置对象，包含远程端口、协议类型、本地端口等信息
   * @throws {Error} 注册失败时抛出错误，包含服务器返回的错误信息
   */
  async registerProxy(config: ProxyConfig): Promise<void> {
    console.log(`正在注册代理: ${config.protocol} :${config.remotePort} -> ${config.localHost || 'localhost'}:${config.localPort}`);

    // 发送注册消息
    const registerMsg: RegisterMessage = createMessage(MessageType.REGISTER, {
      remotePort: config.remotePort,
      protocol: config.protocol,
      localPort: config.localPort,
      localHost: config.localHost,
    });

    const response = await this.controller.sendRequest<RegisterRespMessage>(registerMsg);

    if (!response.payload.success) {
      throw new Error(`注册代理失败: ${response.payload.error}`);
    }

    console.log(`代理已注册: ${response.payload.remoteUrl}`);

    // 创建对应的处理器
    let handler: HttpHandler | WsHandler;
    if (config.protocol === 'http') {
      handler = new HttpHandler(this.controller, config);
    } else {
      handler = new WsHandler(this.controller, config);
    }

    // 设置处理器事件
    handler.on('error', (error) => {
      console.error(`端口 ${config.remotePort} 的处理器错误:`, error);
    });

    this.handlers.set(config.remotePort, handler);
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
    console.log(`代理已注销: 端口 ${remotePort}`);
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
    console.log('连接丢失，正在停止所有处理器...');
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
