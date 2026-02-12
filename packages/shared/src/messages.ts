/**
 * @module messages
 *
 * 穿透代理消息定义模块。
 *
 * 本模块定义了穿透代理系统中客户端与服务端之间通过 WebSocket 控制通道传输的所有消息类型，
 * 包括认证消息、控制消息（注册/注销/心跳）、连接通知消息等，
 * 以及消息的创建、序列化、反序列化和类型守卫等工具函数。
 *
 * 注意：实际数据传输已移至独立的二进制 TCP 数据通道和 UDP 数据通道，
 * WebSocket 控制通道仅用于控制消息。
 */

/**
 * 消息类型枚举
 *
 * 定义穿透代理协议中所有控制消息的类型标识。
 */
export enum MessageType {
  /** 客户端发送的认证请求消息 */
  AUTH = 'auth',
  /** 服务端返回的认证响应消息 */
  AUTH_RESP = 'auth_resp',

  /** 客户端发送的代理注册请求消息 */
  REGISTER = 'register',
  /** 客户端发送的代理注销请求消息 */
  UNREGISTER = 'unregister',
  /** 服务端返回的注册响应消息 */
  REGISTER_RESP = 'register_resp',
  /** 客户端发送的心跳消息 */
  HEARTBEAT = 'heartbeat',
  /** 服务端返回的心跳响应消息 */
  HEARTBEAT_RESP = 'heartbeat_resp',

  /** 服务端发送的新连接通知消息 */
  NEW_CONNECTION = 'new_connection',
  /** 连接关闭通知消息 */
  CONNECTION_CLOSE = 'connection_close',
  /** 连接错误通知消息 */
  CONNECTION_ERROR = 'connection_error',
}

/**
 * 协议类型
 *
 * 穿透代理支持的传输协议类型。
 */
export type Protocol = 'http' | 'websocket' | 'tcp' | 'udp';

/**
 * 基础消息接口
 *
 * 所有消息的公共基类，定义了消息的类型、唯一标识和负载数据。
 */
export interface Message {
  /** 消息类型标识，参见 {@link MessageType} */
  type: MessageType;
  /** 消息的唯一标识符，用于请求-响应配对 */
  id: string;
  /** 消息的负载数据，具体结构取决于消息类型 */
  payload: unknown;
}

/**
 * 认证消息
 *
 * 客户端在建立控制通道后发送的第一条消息，携带认证令牌。
 */
export interface AuthMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.AUTH} */
  type: MessageType.AUTH;
  /** 认证消息负载 */
  payload: {
    /** 客户端的认证令牌 */
    token: string;
  };
}

/**
 * 认证响应消息
 *
 * 服务端对客户端认证请求的响应，表明认证是否成功。
 * 认证成功后会包含服务端分配的 clientId，客户端需要用此 ID 建立数据通道。
 */
export interface AuthRespMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.AUTH_RESP} */
  type: MessageType.AUTH_RESP;
  /** 认证响应负载 */
  payload: {
    /** 认证是否成功 */
    success: boolean;
    /** 服务端分配的客户端 ID（认证成功时返回，用于建立数据通道） */
    clientId?: string;
    /** 认证失败时的错误描述信息 */
    error?: string;
  };
}

/**
 * 注册代理服务消息
 *
 * 客户端向服务端请求注册一条代理隧道，指定远程端口到本地服务的映射。
 * 每个端口同时支持 HTTP、WebSocket、TCP 和 UDP 所有协议。
 */
export interface RegisterMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.REGISTER} */
  type: MessageType.REGISTER;
  /** 注册请求负载 */
  payload: {
    /** 请求在服务端监听的远程端口号 */
    remotePort: number;
    /** 本地服务监听的端口号 */
    localPort: number;
    /** 本地服务的主机地址，默认为 localhost */
    localHost?: string;
  };
}

/**
 * 注册响应消息
 *
 * 服务端对客户端注册请求的响应，表明注册是否成功及分配的远程端口信息。
 */
export interface RegisterRespMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.REGISTER_RESP} */
  type: MessageType.REGISTER_RESP;
  /** 注册响应负载 */
  payload: {
    /** 注册是否成功 */
    success: boolean;
    /** 服务端实际分配的远程端口号 */
    remotePort?: number;
    /** 可通过此 URL 访问代理服务的完整地址 */
    remoteUrl?: string;
    /** 注册失败时的错误描述信息 */
    error?: string;
  };
}

/**
 * 注销代理服务消息
 *
 * 客户端向服务端请求注销一条已注册的代理隧道。
 */
export interface UnregisterMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.UNREGISTER} */
  type: MessageType.UNREGISTER;
  /** 注销请求负载 */
  payload: {
    /** 要注销的远程端口号 */
    remotePort: number;
  };
}

/**
 * 心跳消息
 *
 * 客户端定期发送的心跳消息，用于保持控制通道连接活跃。
 */
export interface HeartbeatMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.HEARTBEAT} */
  type: MessageType.HEARTBEAT;
  /** 心跳消息负载 */
  payload: {
    /** 发送心跳时的时间戳（Unix 毫秒） */
    timestamp: number;
  };
}

/**
 * 心跳响应消息
 *
 * 服务端对客户端心跳消息的响应。
 */
export interface HeartbeatRespMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.HEARTBEAT_RESP} */
  type: MessageType.HEARTBEAT_RESP;
  /** 心跳响应负载 */
  payload: {
    /** 服务端响应时的时间戳（Unix 毫秒） */
    timestamp: number;
  };
}

/**
 * 新连接通知消息
 *
 * 当外部用户连接到服务端的代理端口时，服务端向客户端发送此消息通知新连接的到来。
 * 实际数据传输通过独立的二进制数据通道进行。
 */
export interface NewConnectionMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.NEW_CONNECTION} */
  type: MessageType.NEW_CONNECTION;
  /** 新连接通知负载 */
  payload: {
    /** 新连接的唯一标识符 */
    connectionId: string;
    /** 连接使用的传输协议类型 */
    protocol: Protocol;
    /** 服务端监听的远程端口号 */
    remotePort: number;
    /** 外部客户端的远程地址 */
    remoteAddress?: string;
  };
}

/**
 * 连接关闭消息
 *
 * 通知对方某个代理连接已关闭。
 */
export interface ConnectionCloseMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.CONNECTION_CLOSE} */
  type: MessageType.CONNECTION_CLOSE;
  /** 连接关闭负载 */
  payload: {
    /** 已关闭的连接的唯一标识符 */
    connectionId: string;
  };
}

/**
 * 连接错误消息
 *
 * 通知对方某个代理连接发生了错误。
 */
export interface ConnectionErrorMessage extends Message {
  /** 消息类型，固定为 {@link MessageType.CONNECTION_ERROR} */
  type: MessageType.CONNECTION_ERROR;
  /** 连接错误负载 */
  payload: {
    /** 发生错误的连接的唯一标识符 */
    connectionId: string;
    /** 错误描述信息 */
    error: string;
  };
}

/**
 * 所有消息类型的联合类型
 */
export type AnyMessage =
  | AuthMessage
  | AuthRespMessage
  | RegisterMessage
  | RegisterRespMessage
  | UnregisterMessage
  | HeartbeatMessage
  | HeartbeatRespMessage
  | NewConnectionMessage
  | ConnectionCloseMessage
  | ConnectionErrorMessage;

/**
 * 消息类型守卫
 *
 * 检查一个未知对象是否符合 {@link Message} 接口的基本结构。
 *
 * @param obj - 待检查的未知对象
 * @returns 如果对象包含有效的 `type` 和 `id` 字段则返回 `true`
 */
export function isMessage(obj: unknown): obj is Message {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const msg = obj as Partial<Message>;
  return typeof msg.type === 'string' && typeof msg.id === 'string';
}

/**
 * 检查消息是否为指定类型
 *
 * @typeParam T - 目标消息类型
 * @param msg - 待检查的消息对象
 * @param type - 期望的消息类型标识
 * @returns 如果消息的 `type` 字段与期望类型匹配则返回 `true`
 */
export function isMessageType<T extends AnyMessage>(
  msg: Message,
  type: T['type']
): msg is T {
  return msg.type === type;
}

/**
 * 创建消息
 *
 * 工厂函数，根据指定的消息类型和负载数据创建一条新的消息实例。
 *
 * @typeParam T - 目标消息类型
 * @param type - 消息类型标识
 * @param payload - 消息负载数据
 * @param id - 可选的消息唯一标识符
 * @returns 包含完整字段的消息对象
 */
export function createMessage<T extends Omit<AnyMessage, 'id'>>(
  type: T['type'],
  payload: T['payload'],
  id?: string
): T & { id: string } {
  return {
    type,
    id: id || generateMessageId(),
    payload,
  } as T & { id: string };
}

/**
 * 生成消息ID
 *
 * @returns 唯一的消息 ID 字符串
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 序列化消息
 *
 * @param msg - 要序列化的消息对象
 * @returns 消息的 JSON 字符串表示
 */
export function serializeMessage(msg: Message): string {
  return JSON.stringify(msg);
}

/**
 * 反序列化消息
 *
 * @param data - 要反序列化的 JSON 字符串
 * @returns 解析后的消息对象
 * @throws 当 JSON 解析失败或消息格式无效时抛出错误
 */
export function deserializeMessage(data: string): Message {
  try {
    const msg = JSON.parse(data);
    if (!isMessage(msg)) {
      throw new Error('无效的消息格式');
    }
    return msg;
  } catch (error) {
    throw new Error(`消息反序列化失败: ${error}`);
  }
}
