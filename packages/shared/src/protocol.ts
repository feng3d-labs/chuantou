/**
 * @module protocol
 *
 * 穿透代理协议定义模块。
 *
 * 本模块定义了穿透代理系统的核心协议常量、错误码、默认配置以及各类配置接口。
 * 包括服务端与客户端通信所需的协议版本、控制通道路径、心跳参数、端口范围等关键配置，
 * 以及代理配置、服务器配置、客户端配置、连接信息等数据结构的类型定义。
 */

/**
 * 协议常量
 *
 * 定义穿透代理系统的基础协议参数。
 */
export const PROTOCOL = {
  /** 穿透协议版本号 */
  VERSION: '1.0.0',
  /** 客户端与服务端建立 WebSocket 控制通道的 URL 路径，如 ws://host:9000/control */
  CONTROL_PATH: '/control',
} as const;

/**
 * 协议错误码
 *
 * 枚举穿透代理系统中可能出现的各类错误码，
 * 涵盖认证错误、注册错误、连接错误和通用错误四大类。
 */
export enum ErrorCode {
  /** 认证失败，令牌无效或不匹配 */
  AUTH_FAILED = 'AUTH_FAILED',
  /** 认证超时，客户端未在规定时间内完成认证 */
  AUTH_TIMEOUT = 'AUTH_TIMEOUT',

  /** 端口已被注册，其他客户端已占用该远程端口 */
  PORT_ALREADY_REGISTERED = 'PORT_ALREADY_REGISTERED',
  /** 端口超出允许范围 */
  PORT_OUT_OF_RANGE = 'PORT_OUT_OF_RANGE',
  /** 无效端口号 */
  INVALID_PORT = 'INVALID_PORT',

  /** 未找到指定的连接 */
  CONNECTION_NOT_FOUND = 'CONNECTION_NOT_FOUND',
  /** 连接超时 */
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  /** 未找到指定的客户端 */
  CLIENT_NOT_FOUND = 'CLIENT_NOT_FOUND',

  /** 无效的消息格式 */
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  /** 内部服务器错误 */
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * 协议错误类
 *
 * 继承自 {@link Error}，附带 {@link ErrorCode} 错误码，
 * 用于在穿透代理协议处理过程中抛出结构化的错误信息。
 */
export class ProtocolError extends Error {
  /**
   * 创建一个协议错误实例。
   *
   * @param code - 协议错误码，参见 {@link ErrorCode}
   * @param message - 可读的错误描述信息
   */
  constructor(
    public code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * HTTP 状态码常量
 *
 * 定义穿透代理系统中常用的 HTTP 状态码。
 */
export const HTTP_STATUS = {
  /** 请求成功 */
  OK: 200,
  /** 请求参数错误 */
  BAD_REQUEST: 400,
  /** 未授权，认证失败 */
  UNAUTHORIZED: 401,
  /** 未找到请求的资源 */
  NOT_FOUND: 404,
  /** 服务器内部错误 */
  INTERNAL_SERVER_ERROR: 500,
  /** 网关错误，上游服务不可用 */
  BAD_GATEWAY: 502,
  /** 服务不可用 */
  SERVICE_UNAVAILABLE: 503,
} as const;

/**
 * 默认配置
 *
 * 穿透代理系统的默认运行参数，包括端口、心跳、会话、重连及缓冲区等配置项。
 */
export const DEFAULT_CONFIG = {
  /** 服务端监听的控制端口，客户端通过此端口建立 WebSocket 控制通道进行认证、注册代理等操作 */
  CONTROL_PORT: 9000,
  /** 控制通道的 WebSocket URL 路径，客户端连接地址为 ws://host:{CONTROL_PORT}{CONTROL_PATH} */
  CONTROL_PATH: '/control',

  /** 心跳发送间隔时间，单位毫秒（默认 30 秒） */
  HEARTBEAT_INTERVAL: 30000,
  /** 心跳超时时间，超过此时间未收到心跳视为断连，单位毫秒（默认 60 秒） */
  HEARTBEAT_TIMEOUT: 60000,

  /** 会话超时时间，超时后会话将被清理，单位毫秒（默认 2 分钟） */
  SESSION_TIMEOUT: 120000,

  /** 断线重连间隔时间，单位毫秒（默认 5 秒） */
  RECONNECT_INTERVAL: 5000,
  /** 最大重连尝试次数（默认 10 次） */
  MAX_RECONNECT_ATTEMPTS: 10,

  /** 允许注册的最小端口号 */
  MIN_PORT: 1024,
  /** 允许注册的最大端口号 */
  MAX_PORT: 65535,

  /** 数据传输缓冲区大小，单位字节（默认 64KB） */
  BUFFER_SIZE: 64 * 1024,
} as const;

/**
 * 代理配置接口
 *
 * 描述单条代理隧道的配置，指定远程端口到本地端口的映射关系及传输协议。
 */
export interface ProxyConfig {
  /** 服务端监听的远程端口号，外部用户通过此端口访问代理服务 */
  remotePort: number;
  /** 代理传输协议类型，支持 HTTP 和 WebSocket */
  protocol: 'http' | 'websocket';
  /** 本地服务监听的端口号，代理流量将被转发到此端口 */
  localPort: number;
  /** 本地服务的主机地址，默认为 localhost */
  localHost?: string;
}

/**
 * 服务器配置接口
 *
 * 定义穿透代理服务端的运行参数，包括监听地址、认证令牌、心跳和 TLS 配置。
 */
export interface ServerConfig {
  /** 服务端监听的主机地址 */
  host: string;
  /** 服务端控制通道监听的端口号 */
  controlPort: number;
  /** 允许认证的令牌列表，客户端需提供其中之一才能通过认证 */
  authTokens: string[];
  /** 心跳发送间隔时间，单位毫秒 */
  heartbeatInterval: number;
  /** 会话超时时间，单位毫秒 */
  sessionTimeout: number;
  /**
   * TLS 证书配置，用于启用安全的 WSS 连接。
   * 若不提供则使用非加密的 WS 连接。
   */
  tls?: {
    /** TLS 私钥文件路径或内容 */
    key: string;
    /** TLS 证书文件路径或内容 */
    cert: string;
  };
}

/**
 * 客户端配置接口
 *
 * 定义穿透代理客户端的运行参数，包括服务器地址、认证令牌、重连策略和代理列表。
 */
export interface ClientConfig {
  /** 服务端 WebSocket 控制通道的完整 URL，如 ws://host:9000/control */
  serverUrl: string;
  /** 客户端认证令牌，需与服务端配置的 authTokens 之一匹配 */
  token: string;
  /** 断线重连间隔时间，单位毫秒 */
  reconnectInterval: number;
  /** 最大重连尝试次数，超过后停止重连 */
  maxReconnectAttempts: number;
  /** 需要注册的代理隧道配置列表 */
  proxies: ProxyConfig[];
}

/**
 * 连接信息接口
 *
 * 描述单个代理连接的运行时信息。
 */
export interface ConnectionInfo {
  /** 连接的唯一标识符 */
  id: string;
  /** 发起连接的远程客户端 IP 地址 */
  remoteAddress: string;
  /** 该连接使用的传输协议类型 */
  protocol: 'http' | 'websocket';
  /** 连接建立的时间戳（Unix 毫秒） */
  createdAt: number;
}

/**
 * 客户端信息接口
 *
 * 描述已连接到服务端的客户端的运行时状态信息。
 */
export interface ClientInfo {
  /** 客户端的唯一标识符 */
  id: string;
  /** 客户端是否已通过认证 */
  authenticated: boolean;
  /** 客户端通过认证的时间戳（Unix 毫秒） */
  authenticatedAt?: number;
  /** 最近一次收到心跳的时间戳（Unix 毫秒） */
  lastHeartbeat?: number;
  /** 客户端已注册的远程端口集合 */
  registeredPorts: Set<number>;
  /** 客户端当前活跃的连接映射表，键为连接 ID */
  connections: Map<string, ConnectionInfo>;
}
