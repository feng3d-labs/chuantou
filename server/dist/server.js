"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForwardServer = void 0;
const ws_1 = require("ws");
const session_manager_js_1 = require("./session-manager.js");
const control_handler_js_1 = require("./handlers/control-handler.js");
const http_proxy_js_1 = require("./handlers/http-proxy.js");
const ws_proxy_js_1 = require("./handlers/ws-proxy.js");
/**
 * 转发服务器
 */
class ForwardServer {
    constructor(config) {
        this.config = config;
        this.sessionManager = new session_manager_js_1.SessionManager(this.config.heartbeatInterval, this.config.sessionTimeout);
        this.httpProxyHandler = new http_proxy_js_1.HttpProxyHandler(this.sessionManager);
        this.wsProxyHandler = new ws_proxy_js_1.WsProxyHandler(this.sessionManager);
        this.controlHandler = new control_handler_js_1.ControlHandler(this.sessionManager, this.config, this.httpProxyHandler, this.wsProxyHandler);
    }
    /**
     * 启动服务器
     */
    async start() {
        // 启动控制通道WebSocket服务器
        this.controlServer = new ws_1.WebSocketServer({
            port: this.config.controlPort,
            host: this.config.host,
        });
        this.controlServer.on('connection', (ws) => {
            this.controlHandler.handleConnection(ws);
        });
        this.controlServer.on('error', (error) => {
            console.error('Control server error:', error);
        });
        console.log(`Control server listening on ${this.config.host}:${this.config.controlPort}`);
        // 打印统计信息
        setInterval(() => {
            const stats = this.sessionManager.getStats();
            console.log(`Stats: ${stats.authenticatedClients} authenticated clients, ${stats.totalPorts} ports, ${stats.totalConnections} connections`);
        }, 60000); // 每分钟打印一次
    }
    /**
     * 停止服务器
     */
    async stop() {
        console.log('Stopping server...');
        // 停止控制服务器
        if (this.controlServer) {
            this.controlServer.close();
        }
        // 停止所有代理
        await this.httpProxyHandler.stopAll();
        await this.wsProxyHandler.stopAll();
        // 清理会话
        this.sessionManager.clear();
        console.log('Server stopped');
    }
    /**
     * 获取配置
     */
    getConfig() {
        return this.config;
    }
    /**
     * 获取会话管理器
     */
    getSessionManager() {
        return this.sessionManager;
    }
}
exports.ForwardServer = ForwardServer;
//# sourceMappingURL=server.js.map