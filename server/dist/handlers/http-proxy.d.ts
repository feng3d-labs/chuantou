import { HttpResponseData } from '@zhuanfa/shared';
import { SessionManager } from '../session-manager.js';
/**
 * HTTP代理处理器
 */
export declare class HttpProxyHandler {
    private sessionManager;
    private proxies;
    constructor(sessionManager: SessionManager);
    /**
     * 启动HTTP代理
     */
    startProxy(port: number, clientId: string): Promise<void>;
    /**
     * 处理HTTP请求
     */
    private handleRequest;
    /**
     * 等待客户端响应
     */
    private pendingResponses;
    private waitForResponse;
    /**
     * 处理客户端的响应数据
     */
    handleClientResponse(connectionId: string, data: HttpResponseData): void;
    /**
     * 读取请求体
     */
    private readRequestBody;
    /**
     * 停止HTTP代理
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
//# sourceMappingURL=http-proxy.d.ts.map