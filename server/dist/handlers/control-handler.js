"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlHandler = void 0;
const ws_1 = require("ws");
const shared_1 = require("@zhuanfa/shared");
/**
 * 控制通道处理器 - 处理客户端的控制消息
 */
class ControlHandler {
    constructor(sessionManager, config, httpProxyHandler, wsProxyHandler) {
        this.sessionManager = sessionManager;
        this.config = config;
        this.httpProxyHandler = httpProxyHandler;
        this.wsProxyHandler = wsProxyHandler;
    }
    /**
     * 处理WebSocket连接
     */
    handleConnection(socket) {
        const clientId = this.sessionManager.createSession(socket);
        console.log(`New control connection from client: ${clientId}`);
        // 设置消息处理器
        socket.on('message', (data) => {
            this.handleMessage(clientId, socket, data).catch((error) => {
                console.error(`Error handling message from ${clientId}:`, error);
                this.sendError(socket, `Internal error: ${error.message}`);
            });
        });
        // 设置关闭处理器
        socket.on('close', () => {
            console.log(`Control connection closed: ${clientId}`);
            this.handleDisconnect(clientId);
        });
        // 设置错误处理器
        socket.on('error', (error) => {
            console.error(`Socket error for ${clientId}:`, error);
        });
        // 设置认证超时
        const authTimeout = setTimeout(() => {
            const clientInfo = this.sessionManager.getClientInfo(clientId);
            if (clientInfo && !clientInfo.authenticated) {
                console.log(`Client ${clientId} authentication timeout`);
                socket.close();
            }
        }, 30000); // 30秒认证超时
        // 存储超时引用，以便在认证成功后清除
        socket._authTimeout = authTimeout;
    }
    /**
     * 处理消息
     */
    async handleMessage(clientId, socket, data) {
        try {
            const message = JSON.parse(data.toString());
            const msgType = message.type;
            console.log(`Received message from ${clientId}: ${msgType}`);
            switch (msgType) {
                case shared_1.MessageType.AUTH:
                    await this.handleAuth(clientId, socket, message);
                    break;
                case shared_1.MessageType.REGISTER:
                    await this.handleRegister(clientId, socket, message);
                    break;
                case shared_1.MessageType.UNREGISTER:
                    await this.handleUnregister(clientId, socket, message);
                    break;
                case shared_1.MessageType.HEARTBEAT:
                    await this.handleHeartbeat(clientId, socket, message);
                    break;
                default:
                    console.warn(`Unknown message type: ${msgType}`);
                    this.sendError(socket, `Unknown message type: ${msgType}`);
            }
        }
        catch (error) {
            console.error(`Error parsing message from ${clientId}:`, error);
            this.sendError(socket, 'Invalid message format');
        }
    }
    /**
     * 处理认证消息
     */
    async handleAuth(clientId, socket, message) {
        const { token } = message.payload;
        if (!token) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.AUTH_RESP, {
                success: false,
                error: 'Token is required',
            }));
            socket.close();
            return;
        }
        if (!this.config.isValidToken(token)) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.AUTH_RESP, {
                success: false,
                error: 'Invalid token',
            }));
            socket.close();
            return;
        }
        const authenticated = this.sessionManager.authenticateClient(clientId);
        if (authenticated) {
            // 清除认证超时
            const authTimeout = socket._authTimeout;
            if (authTimeout) {
                clearTimeout(authTimeout);
                delete socket._authTimeout;
            }
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.AUTH_RESP, {
                success: true,
            }));
            console.log(`Client ${clientId} authenticated successfully`);
        }
        else {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.AUTH_RESP, {
                success: false,
                error: 'Authentication failed',
            }));
            socket.close();
        }
    }
    /**
     * 处理注册消息
     */
    async handleRegister(clientId, socket, message) {
        const clientInfo = this.sessionManager.getClientInfo(clientId);
        if (!clientInfo || !clientInfo.authenticated) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: false,
                error: 'Not authenticated',
            }, message.id));
            return;
        }
        const { remotePort, protocol, localPort, localHost } = message.payload;
        // 验证端口
        if (remotePort < 1024 || remotePort > 65535) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: false,
                error: 'Port out of range (1024-65535)',
            }, message.id));
            return;
        }
        // 检查端口是否已被注册
        const existingClientId = this.sessionManager.getClientByPort(remotePort);
        if (existingClientId) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: false,
                error: 'Port already registered',
            }, message.id));
            return;
        }
        // 注册端口
        const registered = this.sessionManager.registerPort(clientId, remotePort);
        if (!registered) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: false,
                error: 'Failed to register port',
            }, message.id));
            return;
        }
        // 启动对应的代理服务器
        try {
            if (protocol === 'http') {
                await this.httpProxyHandler.startProxy(remotePort, clientId);
            }
            else if (protocol === 'websocket') {
                await this.wsProxyHandler.startProxy(remotePort, clientId);
            }
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: true,
                remotePort,
                remoteUrl: `http://${this.config.host}:${remotePort}`,
            }, message.id));
            console.log(`Client ${clientId} registered ${protocol} proxy: port ${remotePort} -> ${localHost || 'localhost'}:${localPort}`);
        }
        catch (error) {
            // 启动代理失败，回滚端口注册
            this.sessionManager.unregisterPort(clientId, remotePort);
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: false,
                error: `Failed to start proxy: ${errorMessage}`,
            }, message.id));
        }
    }
    /**
     * 处理注销消息
     */
    async handleUnregister(clientId, socket, message) {
        const clientInfo = this.sessionManager.getClientInfo(clientId);
        if (!clientInfo || !clientInfo.authenticated) {
            return;
        }
        const { remotePort } = message.payload;
        // 检查端口是否属于该客户端
        if (!clientInfo.registeredPorts.has(remotePort)) {
            this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.REGISTER_RESP, {
                success: false,
                error: 'Port not registered by this client',
            }, message.id));
            return;
        }
        // 停止代理
        await this.httpProxyHandler.stopProxy(remotePort);
        await this.wsProxyHandler.stopProxy(remotePort);
        // 注销端口
        const unregistered = this.sessionManager.unregisterPort(clientId, remotePort);
        if (unregistered) {
            console.log(`Client ${clientId} unregistered port ${remotePort}`);
        }
    }
    /**
     * 处理心跳消息
     */
    async handleHeartbeat(clientId, socket, message) {
        this.sessionManager.updateHeartbeat(clientId);
        this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.HEARTBEAT_RESP, {
            timestamp: Date.now(),
        }, message.id));
    }
    /**
     * 处理断开连接
     */
    handleDisconnect(clientId) {
        const clientInfo = this.sessionManager.getClientInfo(clientId);
        if (clientInfo) {
            // 停止所有代理
            for (const port of clientInfo.registeredPorts) {
                this.httpProxyHandler.stopProxy(port).catch(console.error);
                this.wsProxyHandler.stopProxy(port).catch(console.error);
            }
        }
        this.sessionManager.removeSession(clientId);
    }
    /**
     * 发送消息
     */
    sendMessage(socket, message) {
        if (socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }
    /**
     * 发送错误消息
     */
    sendError(socket, error) {
        this.sendMessage(socket, (0, shared_1.createMessage)(shared_1.MessageType.CONNECTION_ERROR, {
            connectionId: '',
            error,
        }));
    }
}
exports.ControlHandler = ControlHandler;
//# sourceMappingURL=control-handler.js.map