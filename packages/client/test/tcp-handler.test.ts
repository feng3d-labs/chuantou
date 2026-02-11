/**
 * @module tcp-handler.test
 * @description TCP 处理器模块的单元测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Socket } from 'net';
import { Controller } from '../src/controller.js';
import { Config } from '../src/config.js';
import { ProxyConfig, MessageType, createMessage } from '@feng3d/chuantou-shared';
import { TcpHandler } from '../dist/handlers/tcp-handler.js';

// Mock net 模块
vi.mock('net', () => {
  const { EventEmitter } = require('events');

  class MockSocket extends EventEmitter {
    destroyed = false;
    writable = true;
    remoteAddress = '127.0.0.1';
    remotePort = 12345;
    localAddress = '127.0.0.1';
    localPort = 3000;
    connecting = false;

    write = vi.fn(() => true);
    destroy = vi.fn(function(this: MockSocket) {
      this.destroyed = true;
      this.emit('close');
    });
    end = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    setEncoding = vi.fn();
    setKeepAlive = vi.fn();
    setNoDelay = vi.fn();
    setTimeout = vi.fn();
    ref = vi.fn();
    unref = vi.fn();

    connect(options: any, callback?: () => void) {
      this.connecting = true;
      if (callback) {
        setTimeout(() => callback(), 5);
      }
      setTimeout(() => {
        this.connecting = false;
        this.emit('connect');
      }, 10);
      return this;
    }

    pipe = vi.fn(function(this: MockSocket, destination: any) {
      return destination;
    });

    address() {
      return { address: this.localAddress, port: this.localPort };
    }
  }

  return {
    Socket: MockSocket,
    connect: vi.fn((options: any) => new MockSocket().connect(options)),
  };
});

describe('TcpHandler', () => {
  let config: Config;
  let controller: Controller;
  let proxyConfig: ProxyConfig;
  let tcpHandler: TcpHandler;
  let mockWs: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    config = new Config({
      serverUrl: 'ws://localhost:9000',
      token: 'test-token',
      reconnectInterval: 1000,
      maxReconnectAttempts: 3,
      proxies: [],
    });

    controller = new Controller(config);
    proxyConfig = {
      remotePort: 2222,
      localPort: 22,
      localHost: 'localhost',
      protocol: 'tcp',
    };

    // Mock WebSocket
    mockWs = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn(),
    };
    (controller as any).ws = mockWs;
    (controller as any).connected = true;

    // 动态导入 TcpHandler（在 mock 设置之后）
    const handlerModule = await import('../src/handlers/tcp-handler.js');
    tcpHandler = new handlerModule.TcpHandler(controller, proxyConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should create a TCP handler instance', () => {
      expect(tcpHandler).toBeInstanceOf(EventEmitter);
    });

    it('should listen to controller newConnection event', () => {
      const onSpy = vi.spyOn(controller, 'on');
      const handlerModule = require('../dist/handlers/tcp-handler.js');
      const handler = new handlerModule.TcpHandler(controller, proxyConfig);

      expect(onSpy).toHaveBeenCalledWith('newConnection', expect.any(Function));
    });

    it('should listen to controller tcpData event', () => {
      const onSpy = vi.spyOn(controller, 'on');
      const handlerModule = require('../dist/handlers/tcp-handler.js');
      const handler = new handlerModule.TcpHandler(controller, proxyConfig);

      expect(onSpy).toHaveBeenCalledWith('tcpData', expect.any(Function));
    });

    it('should listen to controller connectionClose event', () => {
      const onSpy = vi.spyOn(controller, 'on');
      const handlerModule = require('../dist/handlers/tcp-handler.js');
      const handler = new handlerModule.TcpHandler(controller, proxyConfig);

      expect(onSpy).toHaveBeenCalledWith('connectionClose', expect.any(Function));
    });

    it('should initialize empty localConnections map', () => {
      expect((tcpHandler as any).localConnections.size).toBe(0);
    });
  });

  describe('handleTcpConnection', () => {
    it('should handle TCP protocol connection message', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-123',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待异步连接
      await vi.advanceTimersByTimeAsync(20);

      // 验证连接已创建
      expect((tcpHandler as any).localConnections.has('tcp-conn-123')).toBe(true);
    });

    it('should forward initial data to local service', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-456',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: Buffer.from('SSH-2.0-test').toString('base64'),
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待异步连接
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-456');
      expect(socket).toBeDefined();
      expect(socket.write).toHaveBeenCalledWith(
        Buffer.from('SSH-2.0-test')
      );
    });

    it('should ignore non-TCP protocol connections', () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'http-conn-123',
          protocol: 'http',
          method: 'GET',
          url: '/test',
          headers: {},
          body: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 不应该创建 TCP 连接
      expect((tcpHandler as any).localConnections.size).toBe(0);
    });
  });

  describe('TCP data forwarding', () => {
    it('should forward local socket data to server', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-789',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-789');
      expect(socket).toBeDefined();

      // 模拟 socket 接收到数据
      const testData = Buffer.from('test response from local service');
      socket.emit('data', testData);

      // 验证数据被发送到服务器
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"tcp_data"')
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('tcp-conn-789')
      );
    });

    it('should handle tcpData event from server', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-data',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-data');

      // 模拟服务器发来的 TCP 数据
      const tcpDataMsg = {
        type: 'TcpData',
        payload: {
          connectionId: 'tcp-conn-data',
          data: Buffer.from('data from remote client').toString('base64'),
        },
      };

      controller.emit('tcpData', tcpDataMsg);

      // 验证数据被写入本地 socket
      expect(socket.write).toHaveBeenCalledWith(
        Buffer.from('data from remote client')
      );
    });

    it('should handle invalid base64 data gracefully', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-invalid',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-invalid');

      // 发送无效的 base64 数据
      const tcpDataMsg = {
        type: 'TcpData',
        payload: {
          connectionId: 'tcp-conn-invalid',
          data: 'not-valid-base64!!!',
        },
      };

      // 不应该抛出错误
      expect(() => {
        controller.emit('tcpData', tcpDataMsg);
      }).not.toThrow();
    });
  });

  describe('Connection lifecycle', () => {
    it('should handle socket close event', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-close',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      expect((tcpHandler as any).localConnections.has('tcp-conn-close')).toBe(true);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-close');

      // 触发关闭事件
      socket.emit('close');

      // 连接应该被清理
      expect((tcpHandler as any).localConnections.has('tcp-conn-close')).toBe(false);
    });

    it('should handle socket error event', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-error',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      expect((tcpHandler as any).localConnections.has('tcp-conn-error')).toBe(true);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-error');

      // 触发错误事件
      socket.emit('error', new Error('Connection reset'));

      // 连接应该被清理
      expect((tcpHandler as any).localConnections.has('tcp-conn-error')).toBe(false);
    });

    it('should handle server connection close message', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-server-close',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      expect((tcpHandler as any).localConnections.has('tcp-conn-server-close')).toBe(true);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-server-close');

      // 服务器发送关闭消息
      const closeMsg = {
        id: 'close-msg-id',
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'tcp-conn-server-close' },
      };

      controller.emit('connectionClose', closeMsg);

      // socket 应该被销毁
      expect(socket.destroy).toHaveBeenCalled();
      expect((tcpHandler as any).localConnections.has('tcp-conn-server-close')).toBe(false);
    });

    it('should handle non-existent connection close gracefully', () => {
      const closeMsg = {
        id: 'close-msg-id',
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'non-existent-conn' },
      };

      // 不应该抛出错误
      expect(() => {
        controller.emit('connectionClose', closeMsg);
      }).not.toThrow();
    });
  });

  describe('socket event handlers', () => {
    it('should notify server on socket close', async () => {
      const sendMessageSpy = vi.spyOn(controller, 'sendMessage');

      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-notify',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-notify');

      // 触发关闭事件
      socket.emit('close');

      // 应该通知服务器
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.CONNECTION_CLOSE,
          payload: expect.objectContaining({
            connectionId: 'tcp-conn-notify',
          }),
        })
      );
    });

    it('should notify server on socket error', async () => {
      const sendMessageSpy = vi.spyOn(controller, 'sendMessage');

      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-err-notify',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-err-notify');

      // 触发错误事件
      socket.emit('error', new Error('Socket error'));

      // 应该通知服务器
      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.CONNECTION_CLOSE,
          payload: expect.objectContaining({
            connectionId: 'tcp-conn-err-notify',
          }),
        })
      );
    });
  });

  describe('forwardToServer', () => {
    it('should send data via WebSocket when connected', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-fwd',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-fwd');

      const testData = Buffer.from('test forward data');
      socket.emit('data', testData);

      expect(mockWs.send).toHaveBeenCalled();
      const sentData = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(sentData.type).toBe('tcp_data');
      expect(sentData.connectionId).toBe('tcp-conn-fwd');
      expect(sentData.data).toBe(testData.toString('base64'));
    });

    it('should not send data when WebSocket is not connected', async () => {
      mockWs.readyState = 0; // CONNECTING

      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-no-ws',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-no-ws');

      // 清除之前的 send 调用
      mockWs.send.mockClear();

      const testData = Buffer.from('test data');
      socket.emit('data', testData);

      // 不应该发送
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('handleTcpData', () => {
    it('should write data to existing socket', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-write',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-write');

      const tcpDataMsg = {
        type: 'TcpData',
        payload: {
          connectionId: 'tcp-conn-write',
          data: Buffer.from('remote data').toString('base64'),
        },
      };

      controller.emit('tcpData', tcpDataMsg);

      expect(socket.write).toHaveBeenCalledWith(Buffer.from('remote data'));
    });

    it('should not write to destroyed socket', async () => {
      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-destroyed',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待连接建立
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('tcp-conn-destroyed');
      socket.destroyed = true;

      const tcpDataMsg = {
        type: 'TcpData',
        payload: {
          connectionId: 'tcp-conn-destroyed',
          data: Buffer.from('data').toString('base64'),
        },
      };

      controller.emit('tcpData', tcpDataMsg);

      // 不应该写入已销毁的 socket
      expect(socket.write).not.toHaveBeenCalled();
    });

    it('should handle non-existent connection gracefully', () => {
      const tcpDataMsg = {
        type: 'TcpData',
        payload: {
          connectionId: 'non-existent',
          data: Buffer.from('data').toString('base64'),
        },
      };

      // 不应该抛出错误
      expect(() => {
        controller.emit('tcpData', tcpDataMsg);
      }).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should close all connections', async () => {
      // 创建多个连接
      const connections = ['conn-1', 'conn-2', 'conn-3'];

      for (const connId of connections) {
        const connectionMsg = {
          id: `test-msg-${connId}`,
          type: MessageType.NEW_CONNECTION,
          payload: {
            connectionId: connId,
            protocol: 'tcp',
            remoteAddress: '192.168.1.100',
            data: null,
          },
        };

        controller.emit('newConnection', connectionMsg);
      }

      // 等待所有连接建立
      await vi.advanceTimersByTimeAsync(50);

      expect((tcpHandler as any).localConnections.size).toBe(3);

      // 销毁处理器
      tcpHandler.destroy();

      // 所有连接应该被关闭
      expect((tcpHandler as any).localConnections.size).toBe(0);
    });

    it('should remove all event listeners', () => {
      const removeAllListenersSpy = vi.spyOn(tcpHandler, 'removeAllListeners');

      tcpHandler.destroy();

      expect(removeAllListenersSpy).toHaveBeenCalled();
    });
  });

  describe('Config handling', () => {
    it('should use correct local port from config', async () => {
      const configWithPort = {
        remotePort: 3333,
        localPort: 3306,
        localHost: 'localhost',
        protocol: 'tcp' as const,
      };

      const handlerModule = require('../dist/handlers/tcp-handler.js');
      const handler = new handlerModule.TcpHandler(controller, configWithPort);

      const connectionMsg = {
        id: 'test-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'tcp-conn-port',
          protocol: 'tcp',
          remoteAddress: '192.168.1.100',
          data: null,
        },
      };

      controller.emit('newConnection', connectionMsg);

      // 等待异步连接
      await vi.advanceTimersByTimeAsync(20);

      // 验证使用了正确的配置
      expect(handler.config.localPort).toBe(3306);
    });

    it('should use custom host from config', async () => {
      const configWithHost = {
        remotePort: 4444,
        localPort: 5432,
        localHost: '192.168.1.50',
        protocol: 'tcp' as const,
      };

      const handlerModule = require('../dist/handlers/tcp-handler.js');
      const handler = new handlerModule.TcpHandler(controller, configWithHost);

      expect(handler.config.localHost).toBe('192.168.1.50');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle SSH-like connection flow', async () => {
      // 模拟 SSH 连接流程
      const sshMsg = {
        id: 'ssh-msg-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'ssh-conn',
          protocol: 'tcp',
          remoteAddress: '203.0.113.1',
          data: Buffer.from('SSH-2.0-OpenSSH_8.0').toString('base64'),
        },
      };

      controller.emit('newConnection', sshMsg);

      // 等待连接
      await vi.advanceTimersByTimeAsync(20);

      const socket = (tcpHandler as any).localConnections.get('ssh-conn');
      expect(socket).toBeDefined();

      // 本地 SSH 服务响应
      socket.emit('data', Buffer.from('SSH-2.0-OpenSSH_8.0'));

      // 验证数据被转发
      expect(mockWs.send).toHaveBeenCalled();

      // 连接关闭
      socket.emit('close');
      expect((tcpHandler as any).localConnections.has('ssh-conn')).toBe(false);
    });

    it('should handle multiple concurrent connections', async () => {
      const connections = [];

      // 创建 5 个并发连接
      for (let i = 0; i < 5; i++) {
        const msg = {
          id: `msg-${i}`,
          type: MessageType.NEW_CONNECTION,
          payload: {
            connectionId: `conn-${i}`,
            protocol: 'tcp',
            remoteAddress: `192.168.1.${100 + i}`,
            data: null,
          },
        };

        controller.emit('newConnection', msg);
        connections.push(msg.payload.connectionId);
      }

      // 等待所有连接建立
      await vi.advanceTimersByTimeAsync(50);

      expect((tcpHandler as any).localConnections.size).toBe(5);

      // 验证所有连接都存在
      for (const connId of connections) {
        expect((tcpHandler as any).localConnections.has(connId)).toBe(true);
      }
    });
  });
});
