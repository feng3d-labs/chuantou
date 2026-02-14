/**
 * @module protocol.test
 * @description 协议模块的单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  PROTOCOL,
  ErrorCode,
  ProtocolError,
  HTTP_STATUS,
  DEFAULT_CONFIG,
  ConnectionProtocol,
  ProxyConfig,
  ServerConfig,
  ClientConfig,
  ConnectionInfo,
  ClientInfo,
} from '../src/protocol.js';

describe('protocol - 常量', () => {
  describe('PROTOCOL', () => {
    it('should have correct version', () => {
      expect(PROTOCOL.VERSION).toBe('1.0.0');
    });

    it('should have correct control path', () => {
      expect(PROTOCOL.CONTROL_PATH).toBe('/control');
    });
  });

  describe('HTTP_STATUS', () => {
    it('should have correct status codes', () => {
      expect(HTTP_STATUS.OK).toBe(200);
      expect(HTTP_STATUS.BAD_REQUEST).toBe(400);
      expect(HTTP_STATUS.UNAUTHORIZED).toBe(401);
      expect(HTTP_STATUS.NOT_FOUND).toBe(404);
      expect(HTTP_STATUS.INTERNAL_SERVER_ERROR).toBe(500);
      expect(HTTP_STATUS.BAD_GATEWAY).toBe(502);
      expect(HTTP_STATUS.SERVICE_UNAVAILABLE).toBe(503);
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('should have correct control port', () => {
      expect(DEFAULT_CONFIG.CONTROL_PORT).toBe(9000);
    });

    it('should have correct control path', () => {
      expect(DEFAULT_CONFIG.CONTROL_PATH).toBe('/control');
    });

    it('should have correct heartbeat interval', () => {
      expect(DEFAULT_CONFIG.HEARTBEAT_INTERVAL).toBe(30000);
    });

    it('should have correct heartbeat timeout', () => {
      expect(DEFAULT_CONFIG.HEARTBEAT_TIMEOUT).toBe(60000);
    });

    it('should have correct session timeout', () => {
      expect(DEFAULT_CONFIG.SESSION_TIMEOUT).toBe(120000);
    });

    it('should have correct reconnect interval', () => {
      expect(DEFAULT_CONFIG.RECONNECT_INTERVAL).toBe(5000);
    });

    it('should have correct max reconnect attempts', () => {
      expect(DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS).toBe(Infinity);
    });

    it('should have correct port range', () => {
      expect(DEFAULT_CONFIG.MIN_PORT).toBe(1024);
      expect(DEFAULT_CONFIG.MAX_PORT).toBe(65535);
    });

    it('should have correct buffer size', () => {
      expect(DEFAULT_CONFIG.BUFFER_SIZE).toBe(64 * 1024);
    });
  });
});

describe('protocol - ErrorCode', () => {
  it('should have authentication error codes', () => {
    expect(ErrorCode.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ErrorCode.AUTH_TIMEOUT).toBe('AUTH_TIMEOUT');
  });

  it('should have port error codes', () => {
    expect(ErrorCode.PORT_ALREADY_REGISTERED).toBe('PORT_ALREADY_REGISTERED');
    expect(ErrorCode.PORT_OUT_OF_RANGE).toBe('PORT_OUT_OF_RANGE');
    expect(ErrorCode.INVALID_PORT).toBe('INVALID_PORT');
  });

  it('should have connection error codes', () => {
    expect(ErrorCode.CONNECTION_NOT_FOUND).toBe('CONNECTION_NOT_FOUND');
    expect(ErrorCode.CONNECTION_TIMEOUT).toBe('CONNECTION_TIMEOUT');
    expect(ErrorCode.CLIENT_NOT_FOUND).toBe('CLIENT_NOT_FOUND');
  });

  it('should have general error codes', () => {
    expect(ErrorCode.INVALID_MESSAGE).toBe('INVALID_MESSAGE');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});

describe('protocol - ProtocolError', () => {
  it('should create error with code and message', () => {
    const error = new ProtocolError(ErrorCode.AUTH_FAILED, '认证失败');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(ErrorCode.AUTH_FAILED);
    expect(error.message).toBe('认证失败');
    expect(error.name).toBe('ProtocolError');
  });

  it('should be throwable and catchable', () => {
    expect(() => {
      throw new ProtocolError(ErrorCode.INVALID_PORT, '无效端口');
    }).toThrow(ProtocolError);

    try {
      throw new ProtocolError(ErrorCode.CONNECTION_TIMEOUT, '连接超时');
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolError);
      if (e instanceof ProtocolError) {
        expect(e.code).toBe(ErrorCode.CONNECTION_TIMEOUT);
        expect(e.message).toBe('连接超时');
      }
    }
  });
});

describe('protocol - Type Definitions', () => {
  describe('ConnectionProtocol', () => {
    it('should accept http as valid connection protocol', () => {
      const protocol: ConnectionProtocol = 'http';
      expect(protocol).toBe('http');
    });

    it('should accept websocket as valid connection protocol', () => {
      const protocol: ConnectionProtocol = 'websocket';
      expect(protocol).toBe('websocket');
    });

    it('should accept tcp as valid connection protocol', () => {
      const protocol: ConnectionProtocol = 'tcp';
      expect(protocol).toBe('tcp');
    });
  });

  describe('ProxyConfig', () => {
    it('should create valid proxy config with required fields', () => {
      const config: ProxyConfig = {
        remotePort: 8080,
        localPort: 3000,
      };
      expect(config.remotePort).toBe(8080);
      expect(config.localPort).toBe(3000);
    });

    it('should create valid proxy config with optional fields', () => {
      const config: ProxyConfig = {
        remotePort: 8080,
        localPort: 3000,
        localHost: '192.168.1.100',
      };
      expect(config.localHost).toBe('192.168.1.100');
    });
  });

  describe('ServerConfig', () => {
    it('should create valid server config', () => {
      const config: ServerConfig = {
        host: '0.0.0.0',
        controlPort: 9000,
        authTokens: ['token1', 'token2'],
        heartbeatInterval: 30000,
        sessionTimeout: 120000,
      };
      expect(config.host).toBe('0.0.0.0');
      expect(config.controlPort).toBe(9000);
      expect(config.authTokens).toEqual(['token1', 'token2']);
    });

    it('should accept optional TLS config', () => {
      const config: ServerConfig = {
        host: '0.0.0.0',
        controlPort: 9000,
        authTokens: ['token'],
        heartbeatInterval: 30000,
        sessionTimeout: 120000,
        tls: {
          key: 'private-key',
          cert: 'certificate',
        },
      };
      expect(config.tls?.key).toBe('private-key');
      expect(config.tls?.cert).toBe('certificate');
    });
  });

  describe('ClientConfig', () => {
    it('should create valid client config', () => {
      const config: ClientConfig = {
        serverUrl: 'ws://localhost:9000/control',
        token: 'test-token',
        reconnectInterval: 5000,
        maxReconnectAttempts: 10,
        proxies: [
          { remotePort: 8080, localPort: 3000 },
          { remotePort: 2222, localPort: 22 },
        ],
      };
      expect(config.serverUrl).toBe('ws://localhost:9000/control');
      expect(config.proxies.length).toBe(2);
    });
  });

  describe('ConnectionInfo', () => {
    it('should create valid connection info', () => {
      const info: ConnectionInfo = {
        id: 'conn-123',
        remoteAddress: '192.168.1.100',
        protocol: 'http',
        createdAt: Date.now(),
      };
      expect(info.id).toBe('conn-123');
      expect(info.remoteAddress).toBe('192.168.1.100');
    });
  });

  describe('ClientInfo', () => {
    it('should create valid client info', () => {
      const info: ClientInfo = {
        id: 'client-123',
        authenticated: true,
        authenticatedAt: Date.now(),
        lastHeartbeat: Date.now(),
        registeredPorts: new Set([8080, 8081]),
        connections: new Map(),
      };
      expect(info.id).toBe('client-123');
      expect(info.authenticated).toBe(true);
      expect(info.registeredPorts.has(8080)).toBe(true);
    });
  });
});
