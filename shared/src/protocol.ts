/**
 * 协议常量
 */
export const PROTOCOL = {
  VERSION: '1.0.0',
  CONTROL_PATH: '/control',
} as const;

/**
 * 协议错误码
 */
export enum ErrorCode {
  // 认证错误
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_TIMEOUT = 'AUTH_TIMEOUT',

  // 注册错误
  PORT_ALREADY_REGISTERED = 'PORT_ALREADY_REGISTERED',
  PORT_OUT_OF_RANGE = 'PORT_OUT_OF_RANGE',
  INVALID_PORT = 'INVALID_PORT',

  // 连接错误
  CONNECTION_NOT_FOUND = 'CONNECTION_NOT_FOUND',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CLIENT_NOT_FOUND = 'CLIENT_NOT_FOUND',

  // 通用错误
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * 协议错误类
 */
export class ProtocolError extends Error {
  constructor(
    public code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * HTTP状态码
 */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * 默认配置
 */
export const DEFAULT_CONFIG = {
  // 控制通道配置
  CONTROL_PORT: 9000,
  CONTROL_PATH: '/control',

  // 心跳配置
  HEARTBEAT_INTERVAL: 30000, // 30秒
  HEARTBEAT_TIMEOUT: 60000,  // 60秒

  // 会话配置
  SESSION_TIMEOUT: 120000,  // 2分钟

  // 重连配置
  RECONNECT_INTERVAL: 5000,     // 5秒
  MAX_RECONNECT_ATTEMPTS: 10,   // 最多重连10次

  // 端口范围
  MIN_PORT: 1024,
  MAX_PORT: 65535,

  // 缓冲区大小
  BUFFER_SIZE: 64 * 1024, // 64KB
} as const;

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
