import { ServerConfig } from '@zhuanfa/shared';
/**
 * 配置管理类
 */
export declare class Config implements ServerConfig {
    host: string;
    controlPort: number;
    authTokens: string[];
    heartbeatInterval: number;
    sessionTimeout: number;
    constructor(data?: Partial<ServerConfig>);
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
    /**
     * 验证token
     */
    isValidToken(token: string): boolean;
}
//# sourceMappingURL=config.d.ts.map