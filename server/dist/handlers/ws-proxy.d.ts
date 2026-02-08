import { SessionManager } from '../session-manager.js';
/**
 * WebSocket代理处理器
 */
export declare class WsProxyHandler {
    private sessionManager;
    private proxies;
    constructor(sessionManager: SessionManager);
    /**
     * 启动WebSocket代理
     */
    startProxy(port: number, clientId: string): Promise<void>;
    /**
     * 处理WebSocket连接
     */
    private handleConnection;
    /**
     * 存储用户WebSocket连接
     */
    private userConnections;
    /**
     * 转发消息到客户端
     */
    private forwardToClient;
    /**
     * 通知客户端连接关闭
     */
    private notifyClientClose;
    /**
     * 处理来自客户端的数据
     */
    handleClientData(connectionId: string, data: Buffer): void;
    /**
     * 处理来自客户端的关闭
     */
    handleClientClose(connectionId: string, code?: number): void;
    /**
     * 清理连接
     */
    private cleanupConnection;
    /**
     * 停止WebSocket代理
     */
    stopProxy(port: number): Promise<void>;
    /**
     * 停止所有代理
     */
    stopAll(): Promise<void>;
    /**
     * 获取活跃代理端口列表
     */
    getActivePorts(): number[];
}
//# sourceMappingURL=ws-proxy.d.ts.map