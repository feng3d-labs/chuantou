/**
 * SessionManager 单元测试
 * 测试会话管理器的创建、认证、端口注册、连接跟踪和统计等功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { SessionManager } from '../src/session-manager.js';

/** 创建 mock WebSocket */
function createMockSocket(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    close: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
  } as unknown as WebSocket;
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(30000, 120000);
  });

  afterEach(() => {
    manager.clear();
  });

  describe('会话创建和管理', () => {
    it('应该创建新会话并返回唯一ID', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      expect(clientId).toBeDefined();
      expect(typeof clientId).toBe('string');
      expect(clientId.length).toBeGreaterThan(0);
    });

    it('创建多个会话应该分配不同的ID', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const id1 = manager.createSession(socket1);
      const id2 = manager.createSession(socket2);

      expect(id1).not.toBe(id2);
    });

    it('应该能通过socket查找clientId', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      expect(manager.getClientId(socket)).toBe(clientId);
    });

    it('应该能通过clientId查找socket', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      expect(manager.getClientSocket(clientId)).toBe(socket);
    });

    it('应该能获取客户端信息', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      const info = manager.getClientInfo(clientId);

      expect(info).toBeDefined();
      expect(info!.id).toBe(clientId);
      expect(info!.authenticated).toBe(false);
      expect(info!.registeredPorts.size).toBe(0);
      expect(info!.connections.size).toBe(0);
    });

    it('查找不存在的socket应该返回undefined', () => {
      const socket = createMockSocket();
      expect(manager.getClientId(socket)).toBeUndefined();
    });

    it('查找不存在的clientId应该返回undefined', () => {
      expect(manager.getClientSocket('non-existent')).toBeUndefined();
      expect(manager.getClientInfo('non-existent')).toBeUndefined();
    });
  });

  describe('客户端认证', () => {
    it('应该成功认证已存在的客户端', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      expect(manager.authenticateClient(clientId)).toBe(true);
    });

    it('认证后应该设置authenticated为true', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);

      const info = manager.getClientInfo(clientId);
      expect(info!.authenticated).toBe(true);
    });

    it('认证后应该记录authenticatedAt时间', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      const before = Date.now();
      manager.authenticateClient(clientId);
      const after = Date.now();

      const info = manager.getClientInfo(clientId);
      expect(info!.authenticatedAt).toBeGreaterThanOrEqual(before);
      expect(info!.authenticatedAt).toBeLessThanOrEqual(after);
    });

    it('对不存在的clientId认证应该返回false', () => {
      expect(manager.authenticateClient('non-existent')).toBe(false);
    });
  });

  describe('端口注册', () => {
    let clientId: string;

    beforeEach(() => {
      const socket = createMockSocket();
      clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);
    });

    it('已认证客户端应该能注册端口', () => {
      expect(manager.registerPort(clientId, 8080)).toBe(true);
    });

    it('同一客户端可以注册多个端口', () => {
      expect(manager.registerPort(clientId, 8080)).toBe(true);
      expect(manager.registerPort(clientId, 8081)).toBe(true);
      expect(manager.registerPort(clientId, 8082)).toBe(true);

      const info = manager.getClientInfo(clientId);
      expect(info!.registeredPorts.size).toBe(3);
    });

    it('未认证客户端注册端口应该返回false', () => {
      const socket = createMockSocket();
      const unauthId = manager.createSession(socket);

      expect(manager.registerPort(unauthId, 8080)).toBe(false);
    });

    it('不存在的客户端注册端口应该返回false', () => {
      expect(manager.registerPort('non-existent', 8080)).toBe(false);
    });

    it('不同客户端不能注册相同端口', () => {
      const socket2 = createMockSocket();
      const clientId2 = manager.createSession(socket2);
      manager.authenticateClient(clientId2);

      expect(manager.registerPort(clientId, 8080)).toBe(true);
      expect(manager.registerPort(clientId2, 8080)).toBe(false);
    });

    it('应该通过端口查找到注册它的客户端', () => {
      manager.registerPort(clientId, 8080);

      expect(manager.getClientByPort(8080)).toBe(clientId);
    });

    it('未注册端口查找应该返回undefined', () => {
      expect(manager.getClientByPort(9999)).toBeUndefined();
    });
  });

  describe('端口注销', () => {
    it('应该能注销已注册的端口', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);
      manager.registerPort(clientId, 8080);

      expect(manager.unregisterPort(clientId, 8080)).toBe(true);
      expect(manager.getClientByPort(8080)).toBeUndefined();
    });

    it('注销未注册的端口应该返回false', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      expect(manager.unregisterPort(clientId, 8080)).toBe(false);
    });

    it('不存在的客户端注销端口应该返回false', () => {
      expect(manager.unregisterPort('non-existent', 8080)).toBe(false);
    });
  });

  describe('连接管理', () => {
    it('应该能添加连接记录', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.addConnection(clientId, 'conn-1', '192.168.1.1', 'http');

      const info = manager.getClientInfo(clientId);
      expect(info!.connections.size).toBe(1);

      const conn = info!.connections.get('conn-1');
      expect(conn).toBeDefined();
      expect(conn!.remoteAddress).toBe('192.168.1.1');
      expect(conn!.protocol).toBe('http');
    });

    it('应该能移除连接记录', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.addConnection(clientId, 'conn-1', '192.168.1.1', 'http');

      manager.removeConnection('conn-1');

      const info = manager.getClientInfo(clientId);
      expect(info!.connections.size).toBe(0);
    });

    it('对不存在的客户端添加连接应该静默忽略', () => {
      // 不应抛出错误
      manager.addConnection('non-existent', 'conn-1', '192.168.1.1', 'http');
    });
  });

  describe('会话移除', () => {
    it('应该能通过clientId移除会话', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      manager.removeSession(clientId);

      expect(manager.getClientInfo(clientId)).toBeUndefined();
      expect(manager.getClientId(socket)).toBeUndefined();
    });

    it('移除会话应该清理connections和registeredPorts', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);
      manager.registerPort(clientId, 8080);
      manager.addConnection(clientId, 'conn-1', '192.168.1.1', 'http');

      manager.removeSession(clientId);

      expect(manager.getClientByPort(8080)).toBeUndefined();
    });

    it('应该能通过socket移除会话', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);

      manager.removeSessionBySocket(socket);

      expect(manager.getClientInfo(clientId)).toBeUndefined();
    });

    it('移除不存在的session应该静默忽略', () => {
      manager.removeSession('non-existent');
      manager.removeSessionBySocket(createMockSocket());
    });
  });

  describe('心跳管理', () => {
    it('应该能更新心跳时间', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      const before = Date.now();

      manager.updateHeartbeat(clientId);

      const info = manager.getClientInfo(clientId);
      expect(info!.lastHeartbeat).toBeGreaterThanOrEqual(before);
      expect(info!.lastHeartbeat).toBeLessThanOrEqual(Date.now());
    });

    it('对不存在的客户端更新心跳应该静默忽略', () => {
      manager.updateHeartbeat('non-existent');
    });
  });

  describe('统计信息', () => {
    it('空状态应该返回全零统计', () => {
      const stats = manager.getStats();

      expect(stats.totalClients).toBe(0);
      expect(stats.authenticatedClients).toBe(0);
      expect(stats.totalConnections).toBe(0);
      expect(stats.totalPorts).toBe(0);
    });

    it('应该正确统计已认证客户端数量', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const id1 = manager.createSession(socket1);
      manager.createSession(socket2);
      manager.authenticateClient(id1);

      const stats = manager.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.authenticatedClients).toBe(1);
    });

    it('应该正确统计端口和连接数量', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);
      manager.registerPort(clientId, 8080);
      manager.registerPort(clientId, 8081);
      manager.addConnection(clientId, 'conn-1', '127.0.0.1', 'http');
      manager.addConnection(clientId, 'conn-2', '127.0.0.1', 'websocket');

      const stats = manager.getStats();
      expect(stats.totalPorts).toBe(2);
      expect(stats.totalConnections).toBe(2);
    });

    it('getAuthenticatedClients应该返回已认证的ID列表', () => {
      const socket1 = createMockSocket();
      const socket2 = createMockSocket();
      const id1 = manager.createSession(socket1);
      const id2 = manager.createSession(socket2);
      manager.authenticateClient(id1);

      const authenticated = manager.getAuthenticatedClients();
      expect(authenticated).toContain(id1);
      expect(authenticated).not.toContain(id2);
    });

    it('getAllRegisteredPorts应该返回端口到客户端的映射', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);
      manager.registerPort(clientId, 8080);
      manager.registerPort(clientId, 8081);

      const ports = manager.getAllRegisteredPorts();
      expect(ports.get(8080)).toBe(clientId);
      expect(ports.get(8081)).toBe(clientId);
      expect(ports.size).toBe(2);
    });
  });

  describe('清理', () => {
    it('clear应该清除所有会话和映射', () => {
      const socket = createMockSocket();
      const clientId = manager.createSession(socket);
      manager.authenticateClient(clientId);
      manager.registerPort(clientId, 8080);

      manager.clear();

      expect(manager.getClientInfo(clientId)).toBeUndefined();
      expect(manager.getClientId(socket)).toBeUndefined();
      expect(manager.getStats().totalClients).toBe(0);
    });
  });
});
