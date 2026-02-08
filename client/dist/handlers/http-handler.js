"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpHandler = void 0;
const events_1 = require("events");
const http_1 = require("http");
const https_1 = require("https");
const url_1 = require("url");
/**
 * HTTP请求处理器
 */
class HttpHandler extends events_1.EventEmitter {
    constructor(controller, config) {
        super();
        this.pendingConnections = new Map();
        this.controller = controller;
        this.config = config;
        // 监听新连接事件
        this.controller.on('newConnection', (msg) => {
            if (msg.payload.protocol === 'http') {
                this.handleNewConnection(msg);
            }
        });
        // 监听连接关闭事件
        this.controller.on('connectionClose', (msg) => {
            this.handleConnectionClose(msg);
        });
    }
    /**
     * 处理新连接
     */
    async handleNewConnection(msg) {
        const { connectionId, method, url, headers, body } = msg.payload;
        console.log(`HTTP request: ${method} ${url} (${connectionId})`);
        // 构建本地URL
        const localUrl = `http://${this.config.localHost || 'localhost'}:${this.config.localPort}${url}`;
        const parsedUrl = new url_1.URL(localUrl);
        // 准备请求选项
        const options = {
            method,
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || this.config.localPort,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: this.filterHeaders(headers),
            rejectUnauthorized: false,
        };
        // 创建请求
        const requestFn = parsedUrl.protocol === 'https:' ? https_1.request : http_1.request;
        try {
            const req = requestFn(options, (res) => {
                const response = {
                    statusCode: res.statusCode || 200,
                    headers: res.headers,
                };
                // 收集响应体
                const chunks = [];
                res.on('data', (chunk) => {
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    response.body = Buffer.concat(chunks).toString('base64');
                    this.sendResponse(connectionId, response);
                });
                res.on('error', (error) => {
                    this.sendError(connectionId, error.message);
                });
            });
            req.on('error', (error) => {
                this.sendError(connectionId, error.message);
            });
            // 发送请求体
            if (body) {
                req.write(Buffer.from(body, 'base64'));
            }
            req.end();
            // 存储请求引用，用于取消
            this.pendingConnections.set(connectionId, { req, resolve: () => { }, reject: () => { } });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.sendError(connectionId, errorMessage);
        }
    }
    /**
     * 发送响应
     */
    sendResponse(connectionId, response) {
        const controller = this.controller;
        if (controller.ws && controller.ws.readyState === 1) {
            controller.ws.send(JSON.stringify({
                type: 'http_response',
                connectionId,
                ...response,
            }));
        }
        this.pendingConnections.delete(connectionId);
    }
    /**
     * 发送错误
     */
    sendError(connectionId, error) {
        this.sendResponse(connectionId, {
            statusCode: 500,
            headers: {},
            body: error,
        });
        this.emit('error', new Error(`Connection ${connectionId} error: ${error}`));
    }
    /**
     * 处理连接关闭
     */
    handleConnectionClose(msg) {
        const pending = this.pendingConnections.get(msg.payload.connectionId);
        if (pending) {
            pending.req.destroy();
            this.pendingConnections.delete(msg.payload.connectionId);
        }
    }
    /**
     * 过滤请求头
     */
    filterHeaders(headers) {
        if (!headers) {
            return {};
        }
        const filtered = {};
        const hopByHopHeaders = [
            'connection',
            'keep-alive',
            'proxy-authenticate',
            'proxy-authorization',
            'te',
            'trailers',
            'transfer-encoding',
            'upgrade',
        ];
        for (const [key, value] of Object.entries(headers)) {
            if (!hopByHopHeaders.includes(key.toLowerCase()) && value !== undefined) {
                filtered[key] = Array.isArray(value) ? value.join(', ') : value;
            }
        }
        return filtered;
    }
    /**
     * 销毁
     */
    destroy() {
        for (const { req } of this.pendingConnections.values()) {
            req.destroy();
        }
        this.pendingConnections.clear();
        this.removeAllListeners();
    }
}
exports.HttpHandler = HttpHandler;
//# sourceMappingURL=http-handler.js.map