/**
 * 认证管理器
 */
export declare class AuthManager {
    private pendingAuth;
    private authTimeout;
    constructor(authTimeout?: number);
    /**
     * 开始认证流程
     */
    startAuth(socket: any, callback: (success: boolean, error?: string) => void): void;
    /**
     * 完成认证
     */
    completeAuth(authId: string, success: boolean): void;
    /**
     * 清理
     */
    clear(): void;
}
//# sourceMappingURL=auth.d.ts.map