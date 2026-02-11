import { v4 as uuidv4 } from 'uuid';
import { MessageType, createMessage, AuthRespMessage, ErrorCode } from '@feng3d/chuantou-shared';

/**
 * 认证管理器
 */
export class AuthManager {
  private pendingAuth: Map<string, { socket: any; timeout: NodeJS.Timeout }>;
  private authTimeout: number;

  constructor(authTimeout: number = 30000) {
    this.pendingAuth = new Map();
    this.authTimeout = authTimeout;
  }

  /**
   * 开始认证流程
   */
  startAuth(socket: any, callback: (success: boolean, error?: string) => void): void {
    const authId = uuidv4();

    // 设置认证超时
    const timeout = setTimeout(() => {
      this.pendingAuth.delete(authId);
      callback(false, 'Authentication timeout');
    }, this.authTimeout);

    this.pendingAuth.set(authId, { socket, timeout });

    // 发送认证请求
    const msg = createMessage(MessageType.AUTH_RESP, { success: false, error: 'Auth required' });
    // 这里的逻辑会在control-handler中实现
  }

  /**
   * 完成认证
   */
  completeAuth(authId: string, success: boolean): void {
    const pending = this.pendingAuth.get(authId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingAuth.delete(authId);
    }
  }

  /**
   * 清理
   */
  clear(): void {
    for (const { timeout } of this.pendingAuth.values()) {
      clearTimeout(timeout);
    }
    this.pendingAuth.clear();
  }
}
