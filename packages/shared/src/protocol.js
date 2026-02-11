"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.HTTP_STATUS = exports.ProtocolError = exports.ErrorCode = exports.PROTOCOL = void 0;
/**
 * 协议常量
 */
exports.PROTOCOL = {
    VERSION: '1.0.0',
    CONTROL_PATH: '/control',
};
/**
 * 协议错误码
 */
var ErrorCode;
(function (ErrorCode) {
    // 认证错误
    ErrorCode["AUTH_FAILED"] = "AUTH_FAILED";
    ErrorCode["AUTH_TIMEOUT"] = "AUTH_TIMEOUT";
    // 注册错误
    ErrorCode["PORT_ALREADY_REGISTERED"] = "PORT_ALREADY_REGISTERED";
    ErrorCode["PORT_OUT_OF_RANGE"] = "PORT_OUT_OF_RANGE";
    ErrorCode["INVALID_PORT"] = "INVALID_PORT";
    // 连接错误
    ErrorCode["CONNECTION_NOT_FOUND"] = "CONNECTION_NOT_FOUND";
    ErrorCode["CONNECTION_TIMEOUT"] = "CONNECTION_TIMEOUT";
    ErrorCode["CLIENT_NOT_FOUND"] = "CLIENT_NOT_FOUND";
    // 通用错误
    ErrorCode["INVALID_MESSAGE"] = "INVALID_MESSAGE";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
/**
 * 协议错误类
 */
class ProtocolError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ProtocolError';
    }
}
exports.ProtocolError = ProtocolError;
/**
 * HTTP状态码
 */
exports.HTTP_STATUS = {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
};
/**
 * 默认配置
 */
exports.DEFAULT_CONFIG = {
    // 控制通道配置
    CONTROL_PORT: 9000,
    CONTROL_PATH: '/control',
    // 心跳配置
    HEARTBEAT_INTERVAL: 30000, // 30秒
    HEARTBEAT_TIMEOUT: 60000, // 60秒
    // 会话配置
    SESSION_TIMEOUT: 120000, // 2分钟
    // 重连配置
    RECONNECT_INTERVAL: 5000, // 5秒
    MAX_RECONNECT_ATTEMPTS: 10, // 最多重连10次
    // 端口范围
    MIN_PORT: 1024,
    MAX_PORT: 65535,
    // 缓冲区大小
    BUFFER_SIZE: 64 * 1024, // 64KB
};
//# sourceMappingURL=protocol.js.map