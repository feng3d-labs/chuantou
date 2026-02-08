import { WebSocket } from 'ws';
import { ClientInfo } from '@zhuanfa/shared';
/**
 * 会话管理器 - 管理所有连接的客户端
 */
export declare class SessionManager {
    private clients;
    private socketToClientId;
    private heartbeatInterval;
    private sessionTimeout;
    private heartbeatTimer?;
    constructor(heartbeatInterval?: number, sessionTimeout?: number);
    /**
     * 创建新会话
     */
    createSession(socket: WebSocket): string;
    /**
     * 获取客户端ID
     */
    getClientId(socket: WebSocket): string | undefined;
    /**
     * 获取客户端socket
     */
    getClientSocket(clientId: string): WebSocket | undefined;
    /**
     * 获取客户端信息
     */
    getClientInfo(clientId: string): ClientInfo | undefined;
    /**
     * 认证客户端
     */
    authenticateClient(clientId: string): boolean;
    /**
     * 注册端口
     */
    registerPort(clientId: string, port: number): boolean;
    /**
     * 注销端口
     */
    unregisterPort(clientId: string, port: number): boolean;
    /**
     * 获取注册该端口的客户端ID
     */
    getClientByPort(port: number): string | undefined;
    /**
     * 添加连接
     */
    addConnection(clientId: string, connectionId: string, remoteAddress: string, protocol: 'http' | 'websocket'): void;
    /**
     * 移除连接
     */
    removeConnection(connectionId: string): void;
    /**
     * 移除会话
     */
    removeSession(clientId: string): void;
    /**
     * 移除socket会话
     */
    removeSessionBySocket(socket: WebSocket): void;
    /**
     * 更新心跳时间
     */
    updateHeartbeat(clientId: string): void;
    /**
     * 获取所有已认证客户端
     */
    getAuthenticatedClients(): string[];
    /**
     * 获取所有已注册端口
     */
    getAllRegisteredPorts(): Map<number, string>;
    /**
     * 启动心跳检查
     */
    private startHeartbeatCheck;
    /**
     * 停止心跳检查
     */
    stopHeartbeatCheck(): void;
    /**
     * 获取统计信息
     */
    getStats(): {
        totalClients: number;
        authenticatedClients: number;
        totalConnections: number;
        totalPorts: number;
    };
    /**
     * 清理所有会话
     */
    clear(): void;
}
//# sourceMappingURL=session-manager.d.ts.map