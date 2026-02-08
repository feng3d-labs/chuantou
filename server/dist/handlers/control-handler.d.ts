import { WebSocket } from 'ws';
import { SessionManager } from '../session-manager.js';
import { Config } from '../config.js';
import { HttpProxyHandler } from './http-proxy.js';
import { WsProxyHandler } from './ws-proxy.js';
/**
 * 控制通道处理器 - 处理客户端的控制消息
 */
export declare class ControlHandler {
    private sessionManager;
    private config;
    private httpProxyHandler;
    private wsProxyHandler;
    constructor(sessionManager: SessionManager, config: Config, httpProxyHandler: HttpProxyHandler, wsProxyHandler: WsProxyHandler);
    /**
     * 处理WebSocket连接
     */
    handleConnection(socket: WebSocket): void;
    /**
     * 处理消息
     */
    private handleMessage;
    /**
     * 处理认证消息
     */
    private handleAuth;
    /**
     * 处理注册消息
     */
    private handleRegister;
    /**
     * 处理注销消息
     */
    private handleUnregister;
    /**
     * 处理心跳消息
     */
    private handleHeartbeat;
    /**
     * 处理断开连接
     */
    private handleDisconnect;
    /**
     * 发送消息
     */
    private sendMessage;
    /**
     * 发送错误消息
     */
    private sendError;
}
//# sourceMappingURL=control-handler.d.ts.map