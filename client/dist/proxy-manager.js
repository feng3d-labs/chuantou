"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyManager = void 0;
const http_handler_js_1 = require("./handlers/http-handler.js");
const ws_handler_js_1 = require("./handlers/ws-handler.js");
const shared_1 = require("@zhuanfa/shared");
/**
 * 代理管理器 - 管理所有代理
 */
class ProxyManager {
    constructor(controller) {
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
    async registerProxy(config) {
        console.log(`Registering proxy: ${config.protocol} :${config.remotePort} -> ${config.localHost || 'localhost'}:${config.localPort}`);
        // 发送注册消息
        const registerMsg = (0, shared_1.createMessage)(shared_1.MessageType.REGISTER, {
            remotePort: config.remotePort,
            protocol: config.protocol,
            localPort: config.localPort,
            localHost: config.localHost,
        });
        const response = await this.controller.sendRequest(registerMsg);
        if (!response.payload.success) {
            throw new Error(`Failed to register proxy: ${response.payload.error}`);
        }
        console.log(`Proxy registered: ${response.payload.remoteUrl}`);
        // 创建对应的处理器
        let handler;
        if (config.protocol === 'http') {
            handler = new http_handler_js_1.HttpHandler(this.controller, config);
        }
        else {
            handler = new ws_handler_js_1.WsHandler(this.controller, config);
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
    async unregisterProxy(remotePort) {
        const handler = this.handlers.get(remotePort);
        if (handler) {
            handler.destroy();
            this.handlers.delete(remotePort);
        }
        const unregisterMsg = (0, shared_1.createMessage)(shared_1.MessageType.UNREGISTER, {
            remotePort,
        });
        await this.controller.sendRequest(unregisterMsg);
        console.log(`Proxy unregistered: port ${remotePort}`);
    }
    /**
     * 注销所有代理
     */
    async unregisterAll() {
        const unregisterPromises = [];
        for (const port of this.handlers.keys()) {
            unregisterPromises.push(this.unregisterProxy(port));
        }
        await Promise.all(unregisterPromises);
    }
    /**
     * 断开连接处理
     */
    onDisconnected() {
        console.log('Connection lost, stopping all handlers...');
        for (const handler of this.handlers.values()) {
            handler.destroy();
        }
        this.handlers.clear();
    }
    /**
     * 销毁
     */
    async destroy() {
        await this.unregisterAll();
    }
}
exports.ProxyManager = ProxyManager;
//# sourceMappingURL=proxy-manager.js.map