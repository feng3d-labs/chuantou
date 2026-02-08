"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WsProxyHandler = void 0;
const ws_1 = require("ws");
const uuid_1 = require("uuid");
const shared_1 = require("@zhuanfa/shared");
/**
 * WebSocket代理处理器
 */
class WsProxyHandler {
    constructor(sessionManager) {
        /**
         * 存储用户WebSocket连接
         */
        this.userConnections = new Map();
        this.sessionManager = sessionManager;
        this.proxies = new Map();
    }
    /**
     * 启动WebSocket代理
     */
    async startProxy(port, clientId) {
        if (this.proxies.has(port)) {
            throw new Error(`WebSocket proxy already exists for port ${port}`);
        }
        const server = new ws_1.WebSocketServer({
            port,
            handleProtocols: (protocols, _request) => {
                // 接受所有协议
                const protocolArray = Array.from(protocols);
                return protocolArray.length > 0 ? protocolArray[0] : '';
            },
        });
        server.on('connection', (ws, req) => {
            this.handleConnection(clientId, ws, req).catch((error) => {
                console.error(`Error handling WebSocket connection:`, error);
                ws.close();
            });
        });
        server.on('error', (error) => {
            console.error(`WebSocket proxy error on port ${port}:`, error);
        });
        console.log(`WebSocket proxy listening on port ${port} for client ${clientId}`);
        this.proxies.set(port, server);
    }
    /**
     * 处理WebSocket连接
     */
    async handleConnection(clientId, userWs, req) {
        const connectionId = (0, uuid_1.v4)();
        const clientSocket = this.sessionManager.getClientSocket(clientId);
        if (!clientSocket || clientSocket.readyState !== 1 /* OPEN */) {
            userWs.close(1011, 'Client not connected');
            return;
        }
        // 记录连接
        this.sessionManager.addConnection(clientId, connectionId, req.socket.remoteAddress || '', 'websocket');
        console.log(`WebSocket connection: ${req.url} -> client ${clientId} (${connectionId})`);
        // 存储用户WebSocket引用
        this.userConnections.set(connectionId, userWs);
        // 构建请求头
        const headers = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (value !== undefined) {
                headers[key] = Array.isArray(value) ? value.join(', ') : value;
            }
        }
        // 发送新连接消息给客户端
        const newConnMsg = (0, shared_1.createMessage)(shared_1.MessageType.NEW_CONNECTION, {
            connectionId,
            protocol: 'websocket',
            url: req.url || '/',
            wsHeaders: headers,
        });
        clientSocket.send(JSON.stringify(newConnMsg));
        // 处理来自用户的消息
        userWs.on('message', (data) => {
            this.forwardToClient(clientId, connectionId, data);
        });
        // 处理来自用户关闭
        userWs.on('close', (code, reason) => {
            console.log(`User WebSocket closed: ${connectionId} (${code})`);
            this.notifyClientClose(clientId, connectionId, code);
            this.cleanupConnection(connectionId);
        });
        // 处理错误
        userWs.on('error', (error) => {
            console.error(`User WebSocket error ${connectionId}:`, error);
            this.cleanupConnection(connectionId);
        });
    }
    /**
     * 转发消息到客户端
     */
    forwardToClient(clientId, connectionId, data) {
        const clientSocket = this.sessionManager.getClientSocket(clientId);
        if (clientSocket && clientSocket.readyState === 1) {
            // 发送数据消息
            clientSocket.send(JSON.stringify({
                type: 'connection_data',
                connectionId,
                data: data.toString('base64'),
            }));
        }
    }
    /**
     * 通知客户端连接关闭
     */
    notifyClientClose(clientId, connectionId, code) {
        const clientSocket = this.sessionManager.getClientSocket(clientId);
        if (clientSocket && clientSocket.readyState === 1) {
            const closeMsg = (0, shared_1.createMessage)(shared_1.MessageType.CONNECTION_CLOSE, {
                connectionId,
            });
            clientSocket.send(JSON.stringify(closeMsg));
        }
    }
    /**
     * 处理来自客户端的数据
     */
    handleClientData(connectionId, data) {
        const userWs = this.userConnections.get(connectionId);
        if (userWs && userWs.readyState === 1) {
            userWs.send(data);
        }
    }
    /**
     * 处理来自客户端的关闭
     */
    handleClientClose(connectionId, code) {
        const userWs = this.userConnections.get(connectionId);
        if (userWs) {
            userWs.close(code || 1000);
        }
        this.cleanupConnection(connectionId);
    }
    /**
     * 清理连接
     */
    cleanupConnection(connectionId) {
        this.userConnections.delete(connectionId);
        this.sessionManager.removeConnection(connectionId);
    }
    /**
     * 停止WebSocket代理
     */
    async stopProxy(port) {
        const server = this.proxies.get(port);
        if (server) {
            return new Promise((resolve) => {
                server.close(() => {
                    console.log(`WebSocket proxy stopped on port ${port}`);
                    this.proxies.delete(port);
                    resolve();
                });
            });
        }
    }
    /**
     * 停止所有代理
     */
    async stopAll() {
        const stopPromises = [];
        for (const [port] of this.proxies) {
            stopPromises.push(this.stopProxy(port));
        }
        await Promise.all(stopPromises);
    }
    /**
     * 获取活跃代理端口列表
     */
    getActivePorts() {
        return Array.from(this.proxies.keys());
    }
}
exports.WsProxyHandler = WsProxyHandler;
//# sourceMappingURL=ws-proxy.js.map