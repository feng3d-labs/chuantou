import { EventEmitter } from 'events';
import { Config } from './config.js';
/**
 * 控制器 - 管理与服务器的连接
 */
export declare class Controller extends EventEmitter {
    private config;
    private ws;
    private connected;
    private authenticated;
    private reconnectTimer;
    private heartbeatTimer;
    private reconnectAttempts;
    private pendingRequests;
    constructor(config: Config);
    /**
     * 连接到服务器
     */
    connect(): Promise<void>;
    /**
     * 认证
     */
    private authenticate;
    /**
     * 发送心跳
     */
    private startHeartbeat;
    /**
     * 停止心跳
     */
    private stopHeartbeat;
    /**
     * 安排重连
     */
    private scheduleReconnect;
    /**
     * 计算重连延迟（指数退避）
     */
    private calculateReconnectDelay;
    /**
     * 处理消息
     */
    private handleMessage;
    /**
     * 处理响应消息
     */
    private handleResponse;
    /**
     * 发送请求并等待响应
     */
    sendRequest<T>(message: any, timeout?: number): Promise<T>;
    /**
     * 发送消息
     */
    sendMessage(message: any): boolean;
    /**
     * 检查是否已连接
     */
    isConnected(): boolean;
    /**
     * 检查是否已认证
     */
    isAuthenticated(): boolean;
    /**
     * 断开连接
     */
    disconnect(): void;
    /**
     * 清理
     */
    destroy(): void;
}
//# sourceMappingURL=controller.d.ts.map