/**
 * @module messages.test
 * @description 消息模块的单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MessageType,
  Protocol,
  Message,
  AuthMessage,
  AuthRespMessage,
  RegisterMessage,
  RegisterRespMessage,
  UnregisterMessage,
  HeartbeatMessage,
  HeartbeatRespMessage,
  NewConnectionMessage,
  ConnectionCloseMessage,
  ConnectionErrorMessage,
  AnyMessage,
  isMessage,
  isMessageType,
  createMessage,
  generateMessageId,
  serializeMessage,
  deserializeMessage,
} from '../src/messages.js';

describe('messages - MessageType', () => {
  it('should have correct authentication message types', () => {
    expect(MessageType.AUTH).toBe('auth');
    expect(MessageType.AUTH_RESP).toBe('auth_resp');
  });

  it('should have correct control message types', () => {
    expect(MessageType.REGISTER).toBe('register');
    expect(MessageType.UNREGISTER).toBe('unregister');
    expect(MessageType.REGISTER_RESP).toBe('register_resp');
    expect(MessageType.HEARTBEAT).toBe('heartbeat');
    expect(MessageType.HEARTBEAT_RESP).toBe('heartbeat_resp');
  });

  it('should have correct connection notification types', () => {
    expect(MessageType.NEW_CONNECTION).toBe('new_connection');
    expect(MessageType.CONNECTION_CLOSE).toBe('connection_close');
    expect(MessageType.CONNECTION_ERROR).toBe('connection_error');
  });
});

describe('messages - Protocol type', () => {
  it('should accept valid protocol types', () => {
    const http: Protocol = 'http';
    const ws: Protocol = 'websocket';
    const tcp: Protocol = 'tcp';
    const udp: Protocol = 'udp';

    expect(http).toBe('http');
    expect(ws).toBe('websocket');
    expect(tcp).toBe('tcp');
    expect(udp).toBe('udp');
  });
});

describe('messages - generateMessageId', () => {
  it('should generate unique message IDs', () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();

    expect(id1).toMatch(/^msg_\d+_[a-z0-9]+$/);
    expect(id2).toMatch(/^msg_\d+_[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it('should include timestamp in message ID', () => {
    const before = Date.now();
    const id = generateMessageId();
    const after = Date.now();

    const parts = id.split('_');
    const timestamp = parseInt(parts[1], 10);

    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});

describe('messages - isMessage', () => {
  it('should return true for valid message objects', () => {
    const validMsg = {
      type: MessageType.AUTH,
      id: 'msg-123',
      payload: { token: 'test' },
    };
    expect(isMessage(validMsg)).toBe(true);
  });

  it('should return false for invalid objects', () => {
    expect(isMessage(null)).toBe(false);
    expect(isMessage(undefined)).toBe(false);
    expect(isMessage({})).toBe(false);
    expect(isMessage({ type: 'auth' })).toBe(false);
    expect(isMessage({ id: '123' })).toBe(false);
  });

  it('should return false for non-objects', () => {
    expect(isMessage('string')).toBe(false);
    expect(isMessage(123)).toBe(false);
    expect(isMessage(true)).toBe(false);
  });
});

describe('messages - isMessageType', () => {
  it('should narrow type for AUTH message', () => {
    const msg: Message = {
      type: MessageType.AUTH,
      id: 'msg-1',
      payload: { token: 'test' },
    };

    if (isMessageType<AuthMessage>(msg, MessageType.AUTH)) {
      expect(msg.payload.token).toBe('test');
    } else {
      expect.fail('Should be AUTH message');
    }
  });

  it('should narrow type for HEARTBEAT message', () => {
    const msg: Message = {
      type: MessageType.HEARTBEAT,
      id: 'msg-2',
      payload: { timestamp: Date.now() },
    };

    if (isMessageType<HeartbeatMessage>(msg, MessageType.HEARTBEAT)) {
      expect(typeof msg.payload.timestamp).toBe('number');
    } else {
      expect.fail('Should be HEARTBEAT message');
    }
  });

  it('should return false for mismatched type', () => {
    const msg: Message = {
      type: MessageType.AUTH,
      id: 'msg-1',
      payload: { token: 'test' },
    };

    expect(isMessageType<HeartbeatMessage>(msg, MessageType.HEARTBEAT)).toBe(false);
  });
});

describe('messages - createMessage', () => {
  it('should create AUTH message', () => {
    const msg = createMessage<AuthMessage>(MessageType.AUTH, {
      token: 'test-token',
    });

    expect(msg.type).toBe(MessageType.AUTH);
    expect(msg.payload.token).toBe('test-token');
    expect(msg.id).toMatch(/^msg_\d+_[a-z0-9]+$/);
  });

  it('should create AUTH_RESP message', () => {
    const msg = createMessage<AuthRespMessage>(MessageType.AUTH_RESP, {
      success: true,
    });

    expect(msg.type).toBe(MessageType.AUTH_RESP);
    expect(msg.payload.success).toBe(true);
  });

  it('should create AUTH_RESP message with clientId', () => {
    const msg = createMessage<AuthRespMessage>(MessageType.AUTH_RESP, {
      success: true,
      clientId: 'client-123',
    });

    expect(msg.payload.clientId).toBe('client-123');
  });

  it('should create REGISTER message', () => {
    const msg = createMessage<RegisterMessage>(MessageType.REGISTER, {
      remotePort: 8080,
      localPort: 3000,
      localHost: 'localhost',
    });

    expect(msg.type).toBe(MessageType.REGISTER);
    expect(msg.payload.remotePort).toBe(8080);
    expect(msg.payload.localPort).toBe(3000);
  });

  it('should create UNREGISTER message', () => {
    const msg = createMessage<UnregisterMessage>(MessageType.UNREGISTER, {
      remotePort: 8080,
    });

    expect(msg.type).toBe(MessageType.UNREGISTER);
    expect(msg.payload.remotePort).toBe(8080);
  });

  it('should create HEARTBEAT message', () => {
    const timestamp = Date.now();
    const msg = createMessage<HeartbeatMessage>(MessageType.HEARTBEAT, {
      timestamp,
    });

    expect(msg.type).toBe(MessageType.HEARTBEAT);
    expect(msg.payload.timestamp).toBe(timestamp);
  });

  it('should create HEARTBEAT_RESP message', () => {
    const timestamp = Date.now();
    const msg = createMessage<HeartbeatRespMessage>(
      MessageType.HEARTBEAT_RESP,
      { timestamp }
    );

    expect(msg.type).toBe(MessageType.HEARTBEAT_RESP);
    expect(msg.payload.timestamp).toBe(timestamp);
  });

  it('should create NEW_CONNECTION message for TCP', () => {
    const msg = createMessage<NewConnectionMessage>(MessageType.NEW_CONNECTION, {
      connectionId: 'conn-789',
      protocol: 'tcp',
      remotePort: 8080,
      remoteAddress: '192.168.1.100',
    });

    expect(msg.type).toBe(MessageType.NEW_CONNECTION);
    expect(msg.payload.protocol).toBe('tcp');
    expect(msg.payload.connectionId).toBe('conn-789');
    expect(msg.payload.remotePort).toBe(8080);
    expect(msg.payload.remoteAddress).toBe('192.168.1.100');
  });

  it('should create NEW_CONNECTION message for HTTP', () => {
    const msg = createMessage<NewConnectionMessage>(MessageType.NEW_CONNECTION, {
      connectionId: 'conn-123',
      protocol: 'http',
      remotePort: 80,
    });

    expect(msg.type).toBe(MessageType.NEW_CONNECTION);
    expect(msg.payload.protocol).toBe('http');
  });

  it('should create NEW_CONNECTION message for WebSocket', () => {
    const msg = createMessage<NewConnectionMessage>(MessageType.NEW_CONNECTION, {
      connectionId: 'conn-456',
      protocol: 'websocket',
      remotePort: 8080,
    });

    expect(msg.type).toBe(MessageType.NEW_CONNECTION);
    expect(msg.payload.protocol).toBe('websocket');
  });

  it('should create NEW_CONNECTION message for UDP', () => {
    const msg = createMessage<NewConnectionMessage>(MessageType.NEW_CONNECTION, {
      connectionId: 'conn-udp',
      protocol: 'udp',
      remotePort: 5353,
      remoteAddress: '10.0.0.1',
    });

    expect(msg.type).toBe(MessageType.NEW_CONNECTION);
    expect(msg.payload.protocol).toBe('udp');
    expect(msg.payload.remotePort).toBe(5353);
  });

  it('should create CONNECTION_CLOSE message', () => {
    const msg = createMessage<ConnectionCloseMessage>(
      MessageType.CONNECTION_CLOSE,
      { connectionId: 'conn-123' }
    );

    expect(msg.type).toBe(MessageType.CONNECTION_CLOSE);
    expect(msg.payload.connectionId).toBe('conn-123');
  });

  it('should create CONNECTION_ERROR message', () => {
    const msg = createMessage<ConnectionErrorMessage>(
      MessageType.CONNECTION_ERROR,
      { connectionId: 'conn-123', error: 'Connection timeout' }
    );

    expect(msg.type).toBe(MessageType.CONNECTION_ERROR);
    expect(msg.payload.error).toBe('Connection timeout');
  });

  it('should accept custom message ID', () => {
    const customId = 'custom-message-id';
    const msg = createMessage<AuthMessage>(MessageType.AUTH, { token: 'test' }, customId);

    expect(msg.id).toBe(customId);
  });
});

describe('messages - serializeMessage', () => {
  it('should serialize message to JSON string', () => {
    const msg: Message = {
      type: MessageType.AUTH,
      id: 'msg-1',
      payload: { token: 'test' },
    };

    const serialized = serializeMessage(msg);
    expect(serialized).toBe('{"type":"auth","id":"msg-1","payload":{"token":"test"}}');
  });

  it('should serialize complex message', () => {
    const msg: RegisterMessage = {
      type: MessageType.REGISTER,
      id: 'msg-2',
      payload: {
        remotePort: 8080,
        localPort: 3000,
        localHost: 'localhost',
      },
    };

    const serialized = serializeMessage(msg);
    const parsed = JSON.parse(serialized);

    expect(parsed.type).toBe('register');
    expect(parsed.payload.remotePort).toBe(8080);
  });
});

describe('messages - deserializeMessage', () => {
  it('should deserialize valid JSON to message', () => {
    const json = '{"type":"auth","id":"msg-1","payload":{"token":"test"}}';
    const msg = deserializeMessage(json);

    expect(msg.type).toBe('auth');
    expect(msg.payload.token).toBe('test');
  });

  it('should throw error for invalid JSON', () => {
    expect(() => deserializeMessage('invalid json')).toThrow();
  });

  it('should throw error for message without type', () => {
    const json = '{"id":"msg-1","payload":{"token":"test"}}';
    expect(() => deserializeMessage(json)).toThrow();
  });

  it('should throw error for message without id', () => {
    const json = '{"type":"auth","payload":{"token":"test"}}';
    expect(() => deserializeMessage(json)).toThrow();
  });
});

describe('messages - Message interfaces', () => {
  describe('AnyMessage union', () => {
    it('should accept all message types', () => {
      const messages: AnyMessage[] = [
        createMessage<AuthMessage>(MessageType.AUTH, { token: 'test' }),
        createMessage<AuthRespMessage>(MessageType.AUTH_RESP, { success: true }),
        createMessage<RegisterMessage>(MessageType.REGISTER, {
          remotePort: 8080,
          localPort: 3000,
        }),
        createMessage<HeartbeatMessage>(MessageType.HEARTBEAT, {
          timestamp: Date.now(),
        }),
      ];

      expect(messages.length).toBe(4);
      messages.forEach((msg) => {
        expect(isMessage(msg)).toBe(true);
      });
    });
  });
});

describe('messages - Integration scenarios', () => {
  it('should handle complete authentication flow', () => {
    const authReq = createMessage<AuthMessage>(MessageType.AUTH, {
      token: 'client-token',
    });

    const authResp = createMessage<AuthRespMessage>(MessageType.AUTH_RESP, {
      success: true,
      clientId: 'client-abc',
    }, authReq.id);

    expect(authResp.id).toBe(authReq.id);
    expect(authResp.payload.clientId).toBe('client-abc');
  });

  it('should handle complete registration flow', () => {
    const registerReq = createMessage<RegisterMessage>(MessageType.REGISTER, {
      remotePort: 8080,
      localPort: 3000,
      localHost: 'localhost',
    });

    const registerResp = createMessage<RegisterRespMessage>(
      MessageType.REGISTER_RESP,
      {
        success: true,
        remotePort: 8080,
        remoteUrl: 'http://localhost:8080',
      },
      registerReq.id
    );

    expect(registerResp.payload.remoteUrl).toBe('http://localhost:8080');
  });

  it('should handle heartbeat flow', () => {
    const heartbeat = createMessage<HeartbeatMessage>(MessageType.HEARTBEAT, {
      timestamp: Date.now(),
    });

    const heartbeatResp = createMessage<HeartbeatRespMessage>(
      MessageType.HEARTBEAT_RESP,
      { timestamp: Date.now() },
      heartbeat.id
    );

    expect(heartbeatResp.id).toBe(heartbeat.id);
  });

  it('should handle connection flow', () => {
    const newConn = createMessage<NewConnectionMessage>(MessageType.NEW_CONNECTION, {
      connectionId: 'conn-123',
      protocol: 'tcp',
      remotePort: 8080,
      remoteAddress: '192.168.1.100',
    });

    const closeConn = createMessage<ConnectionCloseMessage>(
      MessageType.CONNECTION_CLOSE,
      { connectionId: 'conn-123' }
    );

    expect(closeConn.payload.connectionId).toBe(newConn.payload.connectionId);
  });
});
