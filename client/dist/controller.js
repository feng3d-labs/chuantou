"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Controller = void 0;
const ws_1 = require("ws");
const events_1 = require("events");
const shared_1 = require("@zhuanfa/shared");
/**
 * 控制器 - 管理与服务器的连接
 */
class Controller extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
        this.reconnectTimer = null;
        this.heartbeatTimer = null;
        this.reconnectAttempts = 0;
        this.pendingRequests = new Map();
        this.config = config;
    }
    /**
     * 连接到服务器
     */
    async connect() {
        return new Promise((resolve, reject) => {
            console.log(`Connecting to ${this.config.serverUrl}...`);
            this.ws = new ws_1.WebSocket(this.config.serverUrl);
            this.ws.on('open', async () => {
                console.log('Connected to server');
                this.connected = true;
                this.reconnectAttempts = 0;
                this.emit('connected');
                // 认证
                try {
                    await this.authenticate();
                    this.startHeartbeat();
                    resolve();
                }
                catch (error) {
                    reject(error);
                }
            });
            this.ws.on('message', (data) => {
                this.handleMessage(data);
            });
            this.ws.on('close', () => {
                console.log('Connection closed');
                this.connected = false;
                this.authenticated = false;
                this.stopHeartbeat();
                this.emit('disconnected');
                this.scheduleReconnect();
            });
            this.ws.on('error', (error) => {
                console.error('WebSocket error:', error.message);
                if (!this.connected) {
                    reject(error);
                }
            });
        });
    }
    /**
     * 认证
     */
    async authenticate() {
        console.log('Authenticating...');
        const authMsg = (0, shared_1.createMessage)(shared_1.MessageType.AUTH, {
            token: this.config.token,
        });
        const response = await this.sendRequest(authMsg);
        if (!response.payload.success) {
            throw new Error(`Authentication failed: ${response.payload.error}`);
        }
        this.authenticated = true;
        console.log('Authenticated successfully');
        this.emit('authenticated');
    }
    /**
     * 发送心跳
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.connected && this.authenticated) {
                const heartbeatMsg = (0, shared_1.createMessage)(shared_1.MessageType.HEARTBEAT, {
                    timestamp: Date.now(),
                });
                this.sendMessage(heartbeatMsg);
            }
        }, 30000); // 30秒
    }
    /**
     * 停止心跳
     */
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    /**
     * 安排重连
     */
    scheduleReconnect() {
        if (this.reconnectTimer) {
            return; // 已经安排了重连
        }
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            this.emit('maxReconnectAttemptsReached');
            return;
        }
        const delay = this.calculateReconnectDelay();
        console.log(`Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts + 1}/${this.config.maxReconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectAttempts++;
            this.connect().catch((error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error('Reconnect failed:', errorMessage);
                this.scheduleReconnect();
            });
        }, delay);
    }
    /**
     * 计算重连延迟（指数退避）
     */
    calculateReconnectDelay() {
        const baseDelay = this.config.reconnectInterval;
        const maxDelay = 60000; // 最大60秒
        const delay = Math.min(baseDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
        // 添加随机抖动
        return delay + Math.random() * 1000;
    }
    /**
     * 处理消息
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data.toString());
            const msgType = message.type;
            switch (msgType) {
                case shared_1.MessageType.AUTH_RESP:
                case shared_1.MessageType.REGISTER_RESP:
                case shared_1.MessageType.HEARTBEAT_RESP:
                    // 响应消息，由pendingRequests处理
                    this.handleResponse(message);
                    break;
                case shared_1.MessageType.NEW_CONNECTION:
                    this.emit('newConnection', message);
                    break;
                case shared_1.MessageType.CONNECTION_CLOSE:
                    this.emit('connectionClose', message);
                    break;
                case shared_1.MessageType.CONNECTION_ERROR:
                    this.emit('connectionError', message);
                    break;
                default:
                    console.warn(`Unknown message type: ${msgType}`);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error handling message:', errorMessage);
        }
    }
    /**
     * 处理响应消息
     */
    handleResponse(message) {
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(message.id);
            pending.resolve(message);
        }
    }
    /**
     * 发送请求并等待响应
     */
    sendRequest(message, timeout = 30000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(message.id);
                reject(new Error('Request timeout'));
            }, timeout);
            this.pendingRequests.set(message.id, { resolve, reject, timeout: timer });
            this.sendMessage(message);
        });
    }
    /**
     * 发送消息
     */
    sendMessage(message) {
        if (this.ws && this.ws.readyState === ws_1.WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        console.error('Cannot send message: not connected');
        return false;
    }
    /**
     * 检查是否已连接
     */
    isConnected() {
        return this.connected;
    }
    /**
     * 检查是否已认证
     */
    isAuthenticated() {
        return this.authenticated;
    }
    /**
     * 断开连接
     */
    disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.authenticated = false;
    }
    /**
     * 清理
     */
    destroy() {
        this.disconnect();
        for (const { timeout } of this.pendingRequests.values()) {
            clearTimeout(timeout);
        }
        this.pendingRequests.clear();
        this.removeAllListeners();
    }
}
exports.Controller = Controller;
//# sourceMappingURL=controller.js.map