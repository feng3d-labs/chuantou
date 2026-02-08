"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const fs_1 = require("fs");
const shared_1 = require("@zhuanfa/shared");
/**
 * 客户端配置类
 */
class Config {
    constructor(data = {}) {
        this.serverUrl = data.serverUrl ?? 'ws://localhost:9000';
        this.token = data.token ?? '';
        this.reconnectInterval = data.reconnectInterval ?? shared_1.DEFAULT_CONFIG.RECONNECT_INTERVAL;
        this.maxReconnectAttempts = data.maxReconnectAttempts ?? shared_1.DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS;
        this.proxies = data.proxies ?? [];
    }
    /**
     * 从JSON文件加载配置
     */
    static async fromFile(configPath) {
        try {
            const content = await fs_1.promises.readFile(configPath, 'utf-8');
            const data = JSON.parse(content);
            return new Config(data);
        }
        catch (error) {
            // 如果文件不存在或解析失败，返回默认配置
            return new Config();
        }
    }
    /**
     * 从环境变量加载配置
     */
    static fromEnv() {
        return new Config({
            serverUrl: process.env.SERVER_URL,
            token: process.env.TOKEN || '',
            reconnectInterval: process.env.RECONNECT_INTERVAL ? parseInt(process.env.RECONNECT_INTERVAL, 10) : undefined,
            maxReconnectAttempts: process.env.MAX_RECONNECT_ATTEMPTS ? parseInt(process.env.MAX_RECONNECT_ATTEMPTS, 10) : undefined,
        });
    }
    /**
     * 验证配置
     */
    validate() {
        if (!this.serverUrl) {
            throw new Error('Server URL is required');
        }
        if (!this.token) {
            throw new Error('Token is required');
        }
        if (!this.serverUrl.startsWith('ws://') && !this.serverUrl.startsWith('wss://')) {
            throw new Error('Server URL must start with ws:// or wss://');
        }
        if (this.proxies.length === 0) {
            throw new Error('At least one proxy configuration is required');
        }
        for (let i = 0; i < this.proxies.length; i++) {
            const proxy = this.proxies[i];
            if (!proxy.remotePort || proxy.remotePort < 1024 || proxy.remotePort > 65535) {
                throw new Error(`Invalid remotePort in proxy[${i}]: ${proxy.remotePort}`);
            }
            if (!proxy.localPort || proxy.localPort < 1 || proxy.localPort > 65535) {
                throw new Error(`Invalid localPort in proxy[${i}]: ${proxy.localPort}`);
            }
            if (proxy.protocol !== 'http' && proxy.protocol !== 'websocket') {
                throw new Error(`Invalid protocol in proxy[${i}]: ${proxy.protocol}`);
            }
        }
    }
}
exports.Config = Config;
//# sourceMappingURL=config.js.map