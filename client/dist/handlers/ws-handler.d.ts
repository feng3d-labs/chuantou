import { EventEmitter } from 'events';
import { Controller } from '../controller.js';
import { ProxyConfig } from '@zhuanfa/shared';
/**
 * WebSocket连接处理器
 */
export declare class WsHandler extends EventEmitter {
    private controller;
    private config;
    private localConnections;
    constructor(controller: Controller, config: ProxyConfig);
    /**
     * 设置数据监听器
     */
    private setupDataListener;
    /**
     * 处理新连接
     */
    private handleNewConnection;
    /**
     * 转发消息到服务器
     */
    private forwardToServer;
    /**
     * 处理来自服务器的数据
     */
    private handleClientData;
    /**
     * 通知服务器连接关闭
     */
    private notifyServerClose;
    /**
     * 处理来自服务器的连接关闭
     */
    private handleConnectionClose;
    /**
     * 清理连接
     */
    private cleanupConnection;
    /**
     * 过滤请求头
     */
    private filterHeaders;
    /**
     * 销毁
     */
    destroy(): void;
}
//# sourceMappingURL=ws-handler.d.ts.map