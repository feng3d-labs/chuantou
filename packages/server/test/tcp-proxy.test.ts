/**
 * @module tcp-proxy.test
 * @description TCP 代理处理器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { TcpProxyHandler } from '../src/handlers/tcp-proxy.js';
import { SessionManager } from '../src/session-manager.js';
import { MessageType } from '@feng3d/chuantou-shared';

describe('TcpProxyHandler', () => {
  let sessionManager: SessionManager;
  let tcpProxy: TcpProxyHandler;
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

    // 创建 TcpProxyHandler
    tcpProxy = new TcpProxyHandler(sessionManager);
  });

  afterEach(() => {
    sessionManager.clear();
  });

  describe('constructor', () => {
    it('should create TcpProxyHandler instance', () => {
      expect(tcpProxy).toBeInstanceOf(TcpProxyHandler);
    });

    it('should initialize empty proxies map', () => {
      expect((tcpProxy as any).proxies.size).toBe(0);
    });

    it('should initialize empty userConnections map', () => {
      expect((tcpProxy as any).userConnections.size).toBe(0);
    });

    it('should initialize empty portToClient map', () => {
      expect((tcpProxy as any).portToClient.size).toBe(0);
    });
  });

  describe('getActivePorts', () => {
    it('should return empty array when no proxies', () => {
      expect(tcpProxy.getActivePorts()).toEqual([]);
    });
  });

  describe('handleClientData', () => {
    it('should write data to user socket', () => {
      const connectionId = 'test-conn';
      const mockSocket = {
        destroyed: false,
        write: vi.fn(),
      };
      (tcpProxy as any).userConnections.set(connectionId, mockSocket);

      const testData = Buffer.from('data from client');
      (tcpProxy as any).handleClientData(connectionId, testData);

      expect(mockSocket.write).toHaveBeenCalledWith(testData);
    });

    it('should not write to destroyed socket', () => {
      const connectionId = 'test-conn-destroyed';
      const mockSocket = {
        destroyed: true,
        write: vi.fn(),
      };
      (tcpProxy as any).userConnections.set(connectionId, mockSocket);

      const testData = Buffer.from('data');
      (tcpProxy as any).handleClientData(connectionId, testData);

      expect(mockSocket.write).not.toHaveBeenCalled();
    });

    it('should handle non-existent connection gracefully', () => {
      const testData = Buffer.from('data');

      expect(() => {
        (tcpProxy as any).handleClientData('non-existent', testData);
      }).not.toThrow();
    });
  });

  describe('handleClientClose', () => {
    it('should destroy user socket', () => {
      const connectionId = 'test-conn';
      const mockSocket = {
        destroy: vi.fn(),
      };
      (tcpProxy as any).userConnections.set(connectionId, mockSocket);

      (tcpProxy as any).handleClientClose(connectionId);

      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('should cleanup connection', () => {
      const connectionId = 'test-conn-cleanup';
      const mockSocket = {
        destroy: vi.fn(),
      };
      (tcpProxy as any).userConnections.set(connectionId, mockSocket);

      (tcpProxy as any).handleClientClose(connectionId);

      expect((tcpProxy as any).userConnections.has(connectionId)).toBe(false);
    });

    it('should handle non-existent connection gracefully', () => {
      expect(() => {
        (tcpProxy as any).handleClientClose('non-existent');
      }).not.toThrow();
    });
  });

  describe('stopProxy', () => {
    it('should handle stopping non-existent port gracefully', async () => {
      await expect(tcpProxy.stopProxy(9999)).resolves.not.toThrow();
    });
  });

  describe('stopAll', () => {
    it('should complete with no proxies running', async () => {
      await expect(tcpProxy.stopAll()).resolves.not.toThrow();
    });
  });

  describe('cleanupConnection', () => {
    it('should remove connection from userConnections map', () => {
      const connectionId = 'test-conn-cleanup';
      (tcpProxy as any).userConnections.set(connectionId, {} as any);

      (tcpProxy as any).cleanupConnection(connectionId);

      expect((tcpProxy as any).userConnections.has(connectionId)).toBe(false);
    });
  });
});
