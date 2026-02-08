import { Controller } from './controller.js';
import { ProxyConfig } from '@zhuanfa/shared';
import { HttpHandler } from './handlers/http-handler.js';
import { WsHandler } from './handlers/ws-handler.js';
import { MessageType, createMessage, RegisterMessage, UnregisterMessage, RegisterRespMessage } from '@zhuanfa/shared';

/**
 * 代理管理器 - 管理所有代理
 */
export class ProxyManager {
  private controller: Controller;
  private handlers: Map<number, HttpHandler | WsHandler>;

  constructor(controller: Controller) {
    this.controller = controller;
    this.handlers = new Map();

    // 监听控制器事件
    this.controller.on('disconnected', () => {
      this.onDisconnected();
    });
  }

  /**
   * 注册代理
   */
  async registerProxy(config: ProxyConfig): Promise<void> {
    console.log(`Registering proxy: ${config.protocol} :${config.remotePort} -> ${config.localHost || 'localhost'}:${config.localPort}`);

    // 发送注册消息
    const registerMsg: RegisterMessage = createMessage(MessageType.REGISTER, {
      remotePort: config.remotePort,
      protocol: config.protocol,
      localPort: config.localPort,
      localHost: config.localHost,
    });

    const response = await this.controller.sendRequest<RegisterRespMessage>(registerMsg);

    if (!response.payload.success) {
      throw new Error(`Failed to register proxy: ${response.payload.error}`);
    }

    console.log(`Proxy registered: ${response.payload.remoteUrl}`);

    // 创建对应的处理器
    let handler: HttpHandler | WsHandler;
    if (config.protocol === 'http') {
      handler = new HttpHandler(this.controller, config);
    } else {
      handler = new WsHandler(this.controller, config);
    }

    // 设置处理器事件
    handler.on('error', (error) => {
      console.error(`Handler error for port ${config.remotePort}:`, error);
    });

    this.handlers.set(config.remotePort, handler);
  }

  /**
   * 注销代理
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
    console.log(`Proxy unregistered: port ${remotePort}`);
  }

  /**
   * 注销所有代理
   */
  async unregisterAll(): Promise<void> {
    const unregisterPromises: Promise<void>[] = [];
    for (const port of this.handlers.keys()) {
      unregisterPromises.push(this.unregisterProxy(port));
    }
    await Promise.all(unregisterPromises);
  }

  /**
   * 断开连接处理
   */
  private onDisconnected(): void {
    console.log('Connection lost, stopping all handlers...');
    for (const handler of this.handlers.values()) {
      handler.destroy();
    }
    this.handlers.clear();
  }

  /**
   * 销毁
   */
  async destroy(): Promise<void> {
    await this.unregisterAll();
  }
}
