import { ClientConfig, ProxyConfig } from '@zhuanfa/shared';
/**
 * 客户端配置类
 */
export declare class Config implements ClientConfig {
    serverUrl: string;
    token: string;
    reconnectInterval: number;
    maxReconnectAttempts: number;
    proxies: ProxyConfig[];
    constructor(data?: Partial<ClientConfig>);
    /**
     * 从JSON文件加载配置
     */
    static fromFile(configPath: string): Promise<Config>;
    /**
     * 从环境变量加载配置
     */
    static fromEnv(): Config;
    /**
     * 验证配置
     */
    validate(): void;
}
//# sourceMappingURL=config.d.ts.map