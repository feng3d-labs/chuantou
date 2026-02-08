"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthManager = void 0;
const uuid_1 = require("uuid");
const shared_1 = require("@zhuanfa/shared");
/**
 * 认证管理器
 */
class AuthManager {
    constructor(authTimeout = 30000) {
        this.pendingAuth = new Map();
        this.authTimeout = authTimeout;
    }
    /**
     * 开始认证流程
     */
    startAuth(socket, callback) {
        const authId = (0, uuid_1.v4)();
        // 设置认证超时
        const timeout = setTimeout(() => {
            this.pendingAuth.delete(authId);
            callback(false, 'Authentication timeout');
        }, this.authTimeout);
        this.pendingAuth.set(authId, { socket, timeout });
        // 发送认证请求
        const msg = (0, shared_1.createMessage)(shared_1.MessageType.AUTH_RESP, { success: false, error: 'Auth required' });
        // 这里的逻辑会在control-handler中实现
    }
    /**
     * 完成认证
     */
    completeAuth(authId, success) {
        const pending = this.pendingAuth.get(authId);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingAuth.delete(authId);
        }
    }
    /**
     * 清理
     */
    clear() {
        for (const { timeout } of this.pendingAuth.values()) {
            clearTimeout(timeout);
        }
        this.pendingAuth.clear();
    }
}
exports.AuthManager = AuthManager;
//# sourceMappingURL=auth.js.map