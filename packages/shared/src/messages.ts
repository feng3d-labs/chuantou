/**
 * 消息类型枚举
 */
export enum MessageType {
  // 认证消息
  AUTH = 'auth',
  AUTH_RESP = 'auth_resp',

  // 控制消息
  REGISTER = 'register',
  UNREGISTER = 'unregister',
  REGISTER_RESP = 'register_resp',
  HEARTBEAT = 'heartbeat',
  HEARTBEAT_RESP = 'heartbeat_resp',

  // 连接通知
  NEW_CONNECTION = 'new_connection',
  CONNECTION_CLOSE = 'connection_close',
  CONNECTION_ERROR = 'connection_error',
}

/**
 * 协议类型
 */
export type Protocol = 'http' | 'websocket';

/**
 * 基础消息接口
 */
export interface Message {
  type: MessageType;
  id: string;
  payload: unknown;
}

/**
 * 认证消息
 */
export interface AuthMessage extends Message {
  type: MessageType.AUTH;
  payload: {
    token: string;
  };
}

/**
 * 认证响应消息
 */
export interface AuthRespMessage extends Message {
  type: MessageType.AUTH_RESP;
  payload: {
    success: boolean;
    error?: string;
  };
}

/**
 * 注册代理服务消息
 */
export interface RegisterMessage extends Message {
  type: MessageType.REGISTER;
  payload: {
    remotePort: number;
    protocol: Protocol;
    localPort: number;
    localHost?: string;
  };
}

/**
 * 注册响应消息
 */
export interface RegisterRespMessage extends Message {
  type: MessageType.REGISTER_RESP;
  payload: {
    success: boolean;
    remotePort?: number;
    remoteUrl?: string;
    error?: string;
  };
}

/**
 * 注销代理服务消息
 */
export interface UnregisterMessage extends Message {
  type: MessageType.UNREGISTER;
  payload: {
    remotePort: number;
  };
}

/**
 * 心跳消息
 */
export interface HeartbeatMessage extends Message {
  type: MessageType.HEARTBEAT;
  payload: {
    timestamp: number;
  };
}

/**
 * 心跳响应消息
 */
export interface HeartbeatRespMessage extends Message {
  type: MessageType.HEARTBEAT_RESP;
  payload: {
    timestamp: number;
  };
}

/**
 * HTTP请求头信息
 */
export interface HttpHeaders {
  [key: string]: string | string[] | undefined;
}

/**
 * 新连接通知消息
 */
export interface NewConnectionMessage extends Message {
  type: MessageType.NEW_CONNECTION;
  payload: {
    connectionId: string;
    protocol: Protocol;
    // HTTP相关
    method?: string;
    url?: string;
    headers?: HttpHeaders;
    body?: string | Buffer;
    // WebSocket相关
    wsHeaders?: HttpHeaders;
  };
}

/**
 * HTTP响应数据
 */
export interface HttpResponseData {
  statusCode: number;
  headers: HttpHeaders;
  body?: string | Buffer;
}

/**
 * 连接关闭消息
 */
export interface ConnectionCloseMessage extends Message {
  type: MessageType.CONNECTION_CLOSE;
  payload: {
    connectionId: string;
  };
}

/**
 * 连接错误消息
 */
export interface ConnectionErrorMessage extends Message {
  type: MessageType.CONNECTION_ERROR;
  payload: {
    connectionId: string;
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
 */
export function isMessageType<T extends AnyMessage>(
  msg: Message,
  type: T['type']
): msg is T {
  return msg.type === type;
}

/**
 * 创建消息
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
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 序列化消息
 */
export function serializeMessage(msg: Message): string {
  return JSON.stringify(msg);
}

/**
 * 反序列化消息
 */
export function deserializeMessage(data: string): Message {
  try {
    const msg = JSON.parse(data);
    if (!isMessage(msg)) {
      throw new Error('Invalid message format');
    }
    return msg;
  } catch (error) {
    throw new Error(`Failed to deserialize message: ${error}`);
  }
}
