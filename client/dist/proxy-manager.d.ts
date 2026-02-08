import { Controller } from './controller.js';
import { ProxyConfig } from '@zhuanfa/shared';
/**
 * 代理管理器 - 管理所有代理
 */
export declare class ProxyManager {
    private controller;
    private handlers;
    constructor(controller: Controller);
    /**
     * 注册代理
     */
    registerProxy(config: ProxyConfig): Promise<void>;
    /**
     * 注销代理
     */
    unregisterProxy(remotePort: number): Promise<void>;
    /**
     * 注销所有代理
     */
    unregisterAll(): Promise<void>;
    /**
     * 断开连接处理
     */
    private onDisconnected;
    /**
     * 销毁
     */
    destroy(): Promise<void>;
}
//# sourceMappingURL=proxy-manager.d.ts.map