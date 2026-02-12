/**
 * @module unified-proxy.test
 * @description 统一代理处理器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { UnifiedProxyHandler } from '../src/handlers/unified-proxy.js';
import { SessionManager } from '../src/session-manager.js';
import { DataChannelManager } from '../src/data-channel.js';
import { MessageType } from '@feng3d/chuantou-shared';

describe('UnifiedProxyHandler', () => {
  let sessionManager: SessionManager;
  let dataChannelManager: DataChannelManager;
  let unifiedProxy: UnifiedProxyHandler;
  let mockClientSocket: any;
  let clientId: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建 SessionManager
    sessionManager = new SessionManager(30000, 120000);

    // 创建 DataChannelManager
    dataChannelManager = new DataChannelManager();

    // 创建 Mock WebSocket
    mockClientSocket = new EventEmitter();
    mockClientSocket.readyState = 1; // WebSocket.OPEN
    mockClientSocket.send = vi.fn();

    // 创建客户端会话
    clientId = sessionManager.createSession(mockClientSocket as any);
    sessionManager.authenticateClient(clientId);

    // 创建 UnifiedProxyHandler
    unifiedProxy = new UnifiedProxyHandler(sessionManager, dataChannelManager);
  });

  afterEach(() => {
    sessionManager.clear();
  });

  describe('constructor', () => {
    it('should create UnifiedProxyHandler instance', () => {
      expect(unifiedProxy).toBeInstanceOf(UnifiedProxyHandler);
    });

    it('should initialize empty proxies map', () => {
      expect((unifiedProxy as any).proxies.size).toBe(0);
    });

    it('should initialize empty userSockets map', () => {
      expect((unifiedProxy as any).userSockets.size).toBe(0);
    });

    it('should initialize empty udpSessions map', () => {
      expect((unifiedProxy as any).udpSessions.size).toBe(0);
    });

    it('should initialize empty udpConnectionToSession map', () => {
      expect((unifiedProxy as any).udpConnectionToSession.size).toBe(0);
    });
  });

  describe('detectProtocol', () => {
    it('should detect GET request as HTTP', () => {
      const data = Buffer.from('GET / HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect POST request as HTTP', () => {
      const data = Buffer.from('POST /api HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect PUT request as HTTP', () => {
      const data = Buffer.from('PUT /resource HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect DELETE request as HTTP', () => {
      const data = Buffer.from('DELETE /resource HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect HEAD request as HTTP', () => {
      const data = Buffer.from('HEAD / HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect OPTIONS request as HTTP', () => {
      const data = Buffer.from('OPTIONS * HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect PATCH request as HTTP', () => {
      const data = Buffer.from('PATCH /resource HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect CONNECT request as HTTP', () => {
      const data = Buffer.from('CONNECT example.com:443 HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('http');
    });

    it('should detect WebSocket upgrade request', () => {
      const data = Buffer.from('GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('websocket');
    });

    it('should return tcp for non-HTTP data', () => {
      const data = Buffer.from('\x00\x01\x02\x03'); // Binary data
      expect((unifiedProxy as any).detectProtocol(data)).toBe('tcp');
    });

    it('should return tcp for SSH handshake', () => {
      const data = Buffer.from('SSH-2.0-OpenSSH_8.0\r\n');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('tcp');
    });

    it('should return tcp for data shorter than 4 bytes', () => {
      const data = Buffer.from('GET');
      expect((unifiedProxy as any).detectProtocol(data)).toBe('tcp');
    });
  });

  describe('handleDataFromClient', () => {
    it('should forward data to user TCP socket', () => {
      const connectionId = 'tcp-conn-test';
      const mockSocket = {
        destroyed: false,
        write: vi.fn(),
      };
      (unifiedProxy as any).userSockets.set(connectionId, mockSocket as any);

      const testData = Buffer.from('test tcp data');
      (unifiedProxy as any).handleDataFromClient(connectionId, testData);

      expect(mockSocket.write).toHaveBeenCalledWith(testData);
    });

    it('should not write to destroyed socket', () => {
      const connectionId = 'tcp-conn-destroyed';
      const mockSocket = {
        destroyed: true,
        write: vi.fn(),
      };
      (unifiedProxy as any).userSockets.set(connectionId, mockSocket as any);

      const testData = Buffer.from('data');
      (unifiedProxy as any).handleDataFromClient(connectionId, testData);

      expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('should handle non-existent connection gracefully', () => {
      const testData = Buffer.from('data');

      expect(() => {
        (unifiedProxy as any).handleDataFromClient('non-existent', testData);
      }).not.toThrow();
    });
  });

  describe('handleClientClose', () => {
    it('should destroy user TCP socket', () => {
      const connectionId = 'tcp-close-test';
      const mockSocket = {
        destroy: vi.fn(),
      };
      (unifiedProxy as any).userSockets.set(connectionId, mockSocket as any);

      unifiedProxy.handleClientClose(connectionId);

      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('should handle non-existent connection gracefully', () => {
      expect(() => {
        unifiedProxy.handleClientClose('non-existent');
      }).not.toThrow();
    });
  });

  describe('cleanupConnection', () => {
    it('should remove from userSockets', () => {
      const connectionId = 'cleanup-test';
      (unifiedProxy as any).userSockets.set(connectionId, {} as any);

      (unifiedProxy as any).cleanupConnection(connectionId);

      expect((unifiedProxy as any).userSockets.has(connectionId)).toBe(false);
    });

    it('should remove from session manager', () => {
      const connectionId = 'cleanup-session-test';
      sessionManager.addConnection(clientId, connectionId, '127.0.0.1', 'tcp');

      (unifiedProxy as any).cleanupConnection(connectionId);

      expect(sessionManager.getStats().totalConnections).toBe(0);
    });
  });

  describe('cleanupUdpSession', () => {
    it('should remove UDP session and related mappings', () => {
      const sessionKey = '10.0.0.1:5000';
      const connectionId = 'udp-conn-test';

      const session = {
        connectionId,
        address: '10.0.0.1',
        port: 5000,
        timer: setTimeout(() => {}, 30000),
      };

      (unifiedProxy as any).udpSessions.set(sessionKey, session);
      (unifiedProxy as any).udpConnectionToSession.set(connectionId, { port: 8080, sessionKey });

      (unifiedProxy as any).cleanupUdpSession(sessionKey);

      expect((unifiedProxy as any).udpSessions.has(sessionKey)).toBe(false);
      expect((unifiedProxy as any).udpConnectionToSession.has(connectionId)).toBe(false);
    });

    it('should handle non-existent session gracefully', () => {
      expect(() => {
        (unifiedProxy as any).cleanupUdpSession('non-existent');
      }).not.toThrow();
    });
  });

  describe('notifyClientClose', () => {
    it('should send CONNECTION_CLOSE message to client', () => {
      (unifiedProxy as any).notifyClientClose(clientId, 'test-conn');

      expect(mockClientSocket.send).toHaveBeenCalled();

      const sentData = JSON.parse(mockClientSocket.send.mock.calls[0][0]);
      expect(sentData.type).toBe(MessageType.CONNECTION_CLOSE);
      expect(sentData.payload.connectionId).toBe('test-conn');
    });

    it('should not send when client WebSocket is not open', () => {
      mockClientSocket.readyState = 0; // CONNECTING
      mockClientSocket.send.mockClear();

      (unifiedProxy as any).notifyClientClose(clientId, 'test-conn');

      expect(mockClientSocket.send).not.toHaveBeenCalled();
    });
  });

  describe('getActivePorts', () => {
    it('should return empty array when no proxies exist', () => {
      expect(unifiedProxy.getActivePorts()).toEqual([]);
    });

    it('should return ports of active proxies', () => {
      (unifiedProxy as any).proxies.set(8080, {});
      (unifiedProxy as any).proxies.set(9090, {});

      expect(unifiedProxy.getActivePorts()).toEqual([8080, 9090]);
    });
  });
});
