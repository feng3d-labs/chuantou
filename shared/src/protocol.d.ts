/**
 * 协议常量
 */
export declare const PROTOCOL: {
    readonly VERSION: "1.0.0";
    readonly CONTROL_PATH: "/control";
};
/**
 * 协议错误码
 */
export declare enum ErrorCode {
    AUTH_FAILED = "AUTH_FAILED",
    AUTH_TIMEOUT = "AUTH_TIMEOUT",
    PORT_ALREADY_REGISTERED = "PORT_ALREADY_REGISTERED",
    PORT_OUT_OF_RANGE = "PORT_OUT_OF_RANGE",
    INVALID_PORT = "INVALID_PORT",
    CONNECTION_NOT_FOUND = "CONNECTION_NOT_FOUND",
    CONNECTION_TIMEOUT = "CONNECTION_TIMEOUT",
    CLIENT_NOT_FOUND = "CLIENT_NOT_FOUND",
    INVALID_MESSAGE = "INVALID_MESSAGE",
    INTERNAL_ERROR = "INTERNAL_ERROR"
}
/**
 * 协议错误类
 */
export declare class ProtocolError extends Error {
    code: ErrorCode;
    constructor(code: ErrorCode, message: string);
}
/**
 * HTTP状态码
 */
export declare const HTTP_STATUS: {
    readonly OK: 200;
    readonly BAD_REQUEST: 400;
    readonly UNAUTHORIZED: 401;
    readonly NOT_FOUND: 404;
    readonly INTERNAL_SERVER_ERROR: 500;
    readonly BAD_GATEWAY: 502;
    readonly SERVICE_UNAVAILABLE: 503;
};
/**
 * 默认配置
 */
export declare const DEFAULT_CONFIG: {
    readonly CONTROL_PORT: 9000;
    readonly CONTROL_PATH: "/control";
    readonly HEARTBEAT_INTERVAL: 30000;
    readonly HEARTBEAT_TIMEOUT: 60000;
    readonly SESSION_TIMEOUT: 120000;
    readonly RECONNECT_INTERVAL: 5000;
    readonly MAX_RECONNECT_ATTEMPTS: 10;
    readonly MIN_PORT: 1024;
    readonly MAX_PORT: 65535;
    readonly BUFFER_SIZE: number;
};
/**
 * 代理配置接口
 */
export interface ProxyConfig {
    remotePort: number;
    protocol: 'http' | 'websocket';
    localPort: number;
    localHost?: string;
}
/**
 * 服务器配置接口
 */
export interface ServerConfig {
    host: string;
    controlPort: number;
    authTokens: string[];
    heartbeatInterval: number;
    sessionTimeout: number;
}
/**
 * 客户端配置接口
 */
export interface ClientConfig {
    serverUrl: string;
    token: string;
    reconnectInterval: number;
    maxReconnectAttempts: number;
    proxies: ProxyConfig[];
}
/**
 * 连接信息接口
 */
export interface ConnectionInfo {
    id: string;
    remoteAddress: string;
    protocol: 'http' | 'websocket';
    createdAt: number;
}
/**
 * 客户端信息接口
 */
export interface ClientInfo {
    id: string;
    authenticated: boolean;
    authenticatedAt?: number;
    lastHeartbeat?: number;
    registeredPorts: Set<number>;
    connections: Map<string, ConnectionInfo>;
}
//# sourceMappingURL=protocol.d.ts.map