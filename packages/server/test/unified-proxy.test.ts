/**
 * @module unified-proxy.test
 * @description 统一代理处理器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { UnifiedProxyHandler } from '../src/handlers/unified-proxy.js';
import { SessionManager } from '../src/session-manager.js';
import { MessageType } from '@feng3d/chuantou-shared';

describe('UnifiedProxyHandler', () => {
  let sessionManager: SessionManager;
  let unifiedProxy: UnifiedProxyHandler;
  let mockClientSocket: any;
  let clientId: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建 SessionManager
    sessionManager = new SessionManager(30000, 120000);

    // 创建 Mock WebSocket
    mockClientSocket = new EventEmitter();
    mockClientSocket.readyState = 1; // WebSocket.OPEN
    mockClientSocket.send = vi.fn();
    mockClientSocket.on = vi.fn();

    // 创建客户端会话
    clientId = sessionManager.createSession(mockClientSocket as any);
    sessionManager.authenticateClient(clientId);

    // 创建 UnifiedProxyHandler
    unifiedProxy = new UnifiedProxyHandler(sessionManager);
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

    it('should initialize empty pendingResponses map', () => {
      expect((unifiedProxy as any).pendingResponses.size).toBe(0);
    });

    it('should initialize empty userConnections map', () => {
      expect((unifiedProxy as any).userConnections.size).toBe(0);
    });

    it('should initialize empty userTcpSockets map', () => {
      expect((unifiedProxy as any).userTcpSockets.size).toBe(0);
    });
  });

  describe('detectHttpProtocol', () => {
    it('should detect GET request', () => {
      const data = Buffer.from('GET / HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect POST request', () => {
      const data = Buffer.from('POST /api HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect PUT request', () => {
      const data = Buffer.from('PUT /resource HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect DELETE request', () => {
      const data = Buffer.from('DELETE /resource HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect HEAD request', () => {
      const data = Buffer.from('HEAD / HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect OPTIONS request', () => {
      const data = Buffer.from('OPTIONS * HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect PATCH request', () => {
      const data = Buffer.from('PATCH /resource HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect TRACE request', () => {
      const data = Buffer.from('TRACE / HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should detect CONNECT request (for HTTPS proxy)', () => {
      const data = Buffer.from('CONNECT example.com:443 HTTP/1.1\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(true);
    });

    it('should return false for non-HTTP data', () => {
      const data = Buffer.from('\x00\x01\x02\x03'); // Binary data
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(false);
    });

    it('should return false for SSH handshake', () => {
      const data = Buffer.from('SSH-2.0-OpenSSH_8.0\r\n');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(false);
    });

    it('should return false for data shorter than 4 bytes', () => {
      const data = Buffer.from('GET');
      expect((unifiedProxy as any).detectHttpProtocol(data)).toBe(false);
    });
  });

  describe('handleClientResponse', () => {
    it('should resolve pending response promise', () => {
      const connectionId = 'test-conn-id';
      const mockWs = new EventEmitter();
      mockWs.readyState = 1;
      mockWs.send = vi.fn();

      const testClient = sessionManager.createSession(mockWs as any);
      sessionManager.authenticateClient(testClient);

      // 创建等待响应的 Promise
      const responsePromise = (unifiedProxy as any).waitForResponse(connectionId, testClient);

      // 模拟客户端响应
      const responseData = {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{"success":true}').toString('base64'),
      };

      setTimeout(() => {
        (unifiedProxy as any).handleClientResponse(connectionId, responseData);
      }, 10);

      return responsePromise.then(response => {
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/json');
      });
    });

    it('should ignore response for non-existent connection', () => {
      expect(() => {
        (unifiedProxy as any).handleClientResponse('non-existent', {});
      }).not.toThrow();
    });
  });

  describe('handleClientData', () => {
    it('should forward data to user WebSocket connection', () => {
      const connectionId = 'ws-conn-test';
      const mockUserWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (unifiedProxy as any).userConnections.set(connectionId, mockUserWs as any);

      const testData = Buffer.from('test websocket data');
      (unifiedProxy as any).handleClientData(connectionId, testData);

      expect(mockUserWs.send).toHaveBeenCalledWith(testData);
    });

    it('should handle non-existent connection gracefully', () => {
      const testData = Buffer.from('data');

      expect(() => {
        (unifiedProxy as any).handleClientData('non-existent', testData);
      }).not.toThrow();
    });
  });

  describe('handleTcpData', () => {
    it('should forward data to user TCP socket', () => {
      const connectionId = 'tcp-conn-test';
      const mockSocket = {
        destroyed: false,
        write: vi.fn(),
      };
      (unifiedProxy as any).userTcpSockets.set(connectionId, mockSocket as any);

      const testData = Buffer.from('test tcp data');
      (unifiedProxy as any).handleTcpData(connectionId, testData);

      expect(mockSocket.write).toHaveBeenCalledWith(testData);
    });

    it('should not write to destroyed socket', () => {
      const connectionId = 'tcp-conn-destroyed';
      const mockSocket = {
        destroyed: true,
        write: vi.fn(),
      };
      (unifiedProxy as any).userTcpSockets.set(connectionId, mockSocket as any);

      const testData = Buffer.from('data');
      (unifiedProxy as any).handleTcpData(connectionId, testData);

      expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('should handle non-existent TCP connection gracefully', () => {
      const testData = Buffer.from('data');

      expect(() => {
        (unifiedProxy as any).handleTcpData('non-existent', testData);
      }).not.toThrow();
    });
  });

  describe('handleClientClose', () => {
    it('should close user WebSocket connection', () => {
      const connectionId = 'ws-close-test';
      const mockUserWs = {
        readyState: 1,
        close: vi.fn(),
      };
      (unifiedProxy as any).userConnections.set(connectionId, mockUserWs as any);

      (unifiedProxy as any).handleClientClose(connectionId, 1000);

      expect(mockUserWs.close).toHaveBeenCalledWith(1000);
      expect((unifiedProxy as any).userConnections.has(connectionId)).toBe(false);
    });

    it('should destroy user TCP socket', () => {
      const connectionId = 'tcp-close-test';
      const mockSocket = {
        destroy: vi.fn(),
      };
      (unifiedProxy as any).userTcpSockets.set(connectionId, mockSocket as any);

      (unifiedProxy as any).handleClientClose(connectionId, 1000);

      expect(mockSocket.destroy).toHaveBeenCalled();
      expect((unifiedProxy as any).userTcpSockets.has(connectionId)).toBe(false);
    });

    it('should handle non-existent connection gracefully', () => {
      expect(() => {
        (unifiedProxy as any).handleClientClose('non-existent');
      }).not.toThrow();
    });
  });

  describe('handleClientStreamData', () => {
    it('should write stream data to response', () => {
      const connectionId = 'stream-conn-test';
      const mockRes = {
        writableEnded: false,
        write: vi.fn(),
      };
      (unifiedProxy as any).streamingResponses.set(connectionId, mockRes as any);

      const streamData = Buffer.from('data: event\n\n');
      (unifiedProxy as any).handleClientStreamData(connectionId, streamData);

      expect(mockRes.write).toHaveBeenCalledWith(streamData);
    });

    it('should not write to ended response', () => {
      const connectionId = 'stream-conn-ended';
      const mockRes = {
        writableEnded: true,
        write: vi.fn(),
      };
      (unifiedProxy as any).streamingResponses.set(connectionId, mockRes as any);

      const streamData = Buffer.from('data');
      (unifiedProxy as any).handleClientStreamData(connectionId, streamData);

      expect(mockRes.write).not.toHaveBeenCalled();
    });

    it('should handle non-existent stream gracefully', () => {
      const streamData = Buffer.from('data');

      expect(() => {
        (unifiedProxy as any).handleClientStreamData('non-existent', streamData);
      }).not.toThrow();
    });
  });

  describe('handleClientStreamEnd', () => {
    it('should end streaming response', () => {
      const connectionId = 'stream-end-test';
      const mockRes = {
        writableEnded: false,
        end: vi.fn(),
      };
      (unifiedProxy as any).streamingResponses.set(connectionId, mockRes as any);

      (unifiedProxy as any).handleClientStreamEnd(connectionId);

      expect(mockRes.end).toHaveBeenCalled();
    });

    it('should not end already ended response', () => {
      const connectionId = 'stream-end-ended';
      const mockRes = {
        writableEnded: true,
        end: vi.fn(),
      };
      (unifiedProxy as any).streamingResponses.set(connectionId, mockRes as any);

      (unifiedProxy as any).handleClientStreamEnd(connectionId);

      expect(mockRes.end).not.toHaveBeenCalled();
    });
  });

  describe('cleanupConnection', () => {
    it('should remove from userConnections', () => {
      const connectionId = 'cleanup-test';
      (unifiedProxy as any).userConnections.set(connectionId, {} as any);

      (unifiedProxy as any).cleanupConnection(connectionId);

      expect((unifiedProxy as any).userConnections.has(connectionId)).toBe(false);
    });

    it('should remove from streamingResponses', () => {
      const connectionId = 'cleanup-stream-test';
      (unifiedProxy as any).streamingResponses.set(connectionId, {} as any);

      (unifiedProxy as any).cleanupConnection(connectionId);

      expect((unifiedProxy as any).streamingResponses.has(connectionId)).toBe(false);
    });

    it('should remove from session manager', () => {
      const connectionId = 'cleanup-session-test';
      sessionManager.addConnection(clientId, connectionId, '127.0.0.1', 'http');

      (unifiedProxy as any).cleanupConnection(connectionId);

      expect(sessionManager.getStats().totalConnections).toBe(0);
    });
  });

  describe('cleanupTcpConnection', () => {
    it('should remove from userTcpSockets', () => {
      const connectionId = 'cleanup-tcp-test';
      (unifiedProxy as any).userTcpSockets.set(connectionId, {} as any);

      (unifiedProxy as any).cleanupTcpConnection(connectionId);

      expect((unifiedProxy as any).userTcpSockets.has(connectionId)).toBe(false);
    });

    it('should remove from session manager', () => {
      const connectionId = 'cleanup-tcp-session-test';
      sessionManager.addConnection(clientId, connectionId, '127.0.0.1', 'tcp');

      (unifiedProxy as any).cleanupTcpConnection(connectionId);

      expect(sessionManager.getStats().totalConnections).toBe(0);
    });
  });

  describe('notifyClientClose', () => {
    it('should send CONNECTION_CLOSE message to client', () => {
      (unifiedProxy as any).notifyClientClose(clientId, 'test-conn', 1000);

      expect(mockClientSocket.send).toHaveBeenCalled();

      const sentData = JSON.parse(mockClientSocket.send.mock.calls[0][0]);
      expect(sentData.type).toBe(MessageType.CONNECTION_CLOSE);
      expect(sentData.payload.connectionId).toBe('test-conn');
    });

    it('should not send when client WebSocket is not open', () => {
      mockClientSocket.readyState = 0; // CONNECTING
      mockClientSocket.send.mockClear();

      (unifiedProxy as any).notifyClientClose(clientId, 'test-conn', 1000);

      expect(mockClientSocket.send).not.toHaveBeenCalled();
    });
  });

  describe('forwardToClient', () => {
    it('should send data via WebSocket when client is connected', () => {
      (unifiedProxy as any).forwardToClient(clientId, 'test-conn', Buffer.from('test data'));

      expect(mockClientSocket.send).toHaveBeenCalled();

      const sentData = JSON.parse(mockClientSocket.send.mock.calls[0][0]);
      expect(sentData.type).toBe('connection_data');
      expect(sentData.connectionId).toBe('test-conn');
    });
  });

  describe('forwardTcpDataToClient', () => {
    it('should send TCP data via WebSocket', () => {
      (unifiedProxy as any).forwardTcpDataToClient(clientId, 'tcp-conn', Buffer.from('tcp data'));

      expect(mockClientSocket.send).toHaveBeenCalled();

      const sentData = JSON.parse(mockClientSocket.send.mock.calls[0][0]);
      expect(sentData.type).toBe('tcp_data');
      expect(sentData.connectionId).toBe('tcp-conn');
    });
  });
});
