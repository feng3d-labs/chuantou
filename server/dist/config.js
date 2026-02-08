"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const fs_1 = require("fs");
const shared_1 = require("@zhuanfa/shared");
/**
 * 配置管理类
 */
class Config {
    constructor(data = {}) {
        this.host = data.host ?? '0.0.0.0';
        this.controlPort = data.controlPort ?? shared_1.DEFAULT_CONFIG.CONTROL_PORT;
        this.authTokens = data.authTokens ?? [];
        this.heartbeatInterval = data.heartbeatInterval ?? shared_1.DEFAULT_CONFIG.HEARTBEAT_INTERVAL;
        this.sessionTimeout = data.sessionTimeout ?? shared_1.DEFAULT_CONFIG.SESSION_TIMEOUT;
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
            host: process.env.HOST,
            controlPort: process.env.CONTROL_PORT ? parseInt(process.env.CONTROL_PORT, 10) : undefined,
            authTokens: process.env.AUTH_TOKENS ? process.env.AUTH_TOKENS.split(',') : undefined,
            heartbeatInterval: process.env.HEARTBEAT_INTERVAL ? parseInt(process.env.HEARTBEAT_INTERVAL, 10) : undefined,
            sessionTimeout: process.env.SESSION_TIMEOUT ? parseInt(process.env.SESSION_TIMEOUT, 10) : undefined,
        });
    }
    /**
     * 验证配置
     */
    validate() {
        if (this.controlPort < 1 || this.controlPort > 65535) {
            throw new Error(`Invalid control port: ${this.controlPort}`);
        }
        if (this.authTokens.length === 0) {
            console.warn('Warning: No auth tokens configured. Server will accept any token.');
        }
        if (this.heartbeatInterval < 1000) {
            throw new Error(`Heartbeat interval too short: ${this.heartbeatInterval}ms`);
        }
    }
    /**
     * 验证token
     */
    isValidToken(token) {
        // 如果没有配置token，接受任何token（开发模式）
        if (this.authTokens.length === 0) {
            return true;
        }
        return this.authTokens.includes(token);
    }
}
exports.Config = Config;
//# sourceMappingURL=config.js.map