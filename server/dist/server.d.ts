import { Config } from './config.js';
import { SessionManager } from './session-manager.js';
/**
 * 转发服务器
 */
export declare class ForwardServer {
    private config;
    private sessionManager;
    private httpProxyHandler;
    private wsProxyHandler;
    private controlHandler;
    private controlServer?;
    constructor(config: Config);
    /**
     * 启动服务器
     */
    start(): Promise<void>;
    /**
     * 停止服务器
     */
    stop(): Promise<void>;
    /**
     * 获取配置
     */
    getConfig(): Config;
    /**
     * 获取会话管理器
     */
    getSessionManager(): SessionManager;
}
//# sourceMappingURL=server.d.ts.map