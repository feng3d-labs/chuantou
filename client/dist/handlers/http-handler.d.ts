import { EventEmitter } from 'events';
import { Controller } from '../controller.js';
import { ProxyConfig } from '@zhuanfa/shared';
/**
 * HTTP请求处理器
 */
export declare class HttpHandler extends EventEmitter {
    private controller;
    private config;
    private pendingConnections;
    constructor(controller: Controller, config: ProxyConfig);
    /**
     * 处理新连接
     */
    private handleNewConnection;
    /**
     * 发送响应
     */
    private sendResponse;
    /**
     * 发送错误
     */
    private sendError;
    /**
     * 处理连接关闭
     */
    private handleConnectionClose;
    /**
     * 过滤请求头
     */
    private filterHeaders;
    /**
     * 销毁
     */
    destroy(): void;
}
//# sourceMappingURL=http-handler.d.ts.map