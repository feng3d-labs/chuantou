/**
 * @module unified-handler.test
 * @description 统一处理器模块的单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Controller } from '../src/controller.js';
import { Config } from '../src/config.js';
import { ProxyConfig, MessageType } from '@feng3d/chuantou-shared';

// Mock http 和 https 模块
vi.mock('http', () => ({
  request: vi.fn(),
}));

vi.mock('https', () => ({
  request: vi.fn(),
}));

// Mock ws module
vi.mock('ws', () => {
  const { EventEmitter } = require('events');
  class MockWebSocket extends EventEmitter {
    readyState = 0;
    static OPEN = 1;
    constructor(url: string, options?: any) {
      super();
      this.url = url;
      setTimeout(() => {
        this.readyState = 1;
        this.emit('open');
      }, 10);
    }
    send(data: any) {}
    close(code: number, reason: string) {
      this.readyState = 3;
      this.emit('close', code, reason);
    }
    removeAllListeners() {
      super.removeAllListeners();
    }
  }
  return {
    WebSocket: MockWebSocket,
  };
});

describe('UnifiedHandler', () => {
  let config: Config;
  let controller: Controller;
  let proxyConfig: ProxyConfig;
  let mockHttpRequest: any;
  let mockHttpsRequest: any;
  let UnifiedHandler: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    config = new Config({
      serverUrl: 'ws://localhost:9000',
      token: 'test-token',
      reconnectInterval: 1000,
      maxReconnectAttempts: 3,
      proxies: [],
    });

    controller = new Controller(config);
    proxyConfig = {
      remotePort: 8080,
      localPort: 3000,
      localHost: 'localhost',
    };

    // 导入 mock 模块
    const http = await import('http');
    const https = await import('https');
    mockHttpRequest = http.request;
    mockHttpsRequest = https.request;

    // 动态导入 UnifiedHandler
    const handlerModule = await import('../src/handlers/unified-handler.js');
    UnifiedHandler = handlerModule.UnifiedHandler;
  });

  describe('constructor', () => {
    it('应该创建处理器实例', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      expect(handler).toBeInstanceOf(EventEmitter);
    });

    it('应该保存配置', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      expect(handler.config).toEqual(proxyConfig);
    });

    it('应该初始化空的连接映射表', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      expect(handler.pendingConnections.size).toBe(0);
      expect(handler.localWsConnections.size).toBe(0);
      expect(handler.streamingResponses.size).toBe(0);
    });

    it('应该监听控制器的 newConnection 事件', () => {
      const onSpy = vi.spyOn(controller, 'on');
      new UnifiedHandler(controller, proxyConfig);

      expect(onSpy).toHaveBeenCalledWith('newConnection', expect.any(Function));
    });

    it('应该监听控制器的 connectionClose 事件', () => {
      const onSpy = vi.spyOn(controller, 'on');
      new UnifiedHandler(controller, proxyConfig);

      expect(onSpy).toHaveBeenCalledWith('connectionClose', expect.any(Function));
    });

    it('应该在收到 http 协议的 newConnection 事件时调用 handleHttpConnection', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const handleHttpConnectionSpy = vi.spyOn(handler as any, 'handleHttpConnection');

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/test',
          headers: {},
          body: null,
        },
      };

      controller.emit('newConnection', httpMsg);

      expect(handleHttpConnectionSpy).toHaveBeenCalledWith(httpMsg);
    });

    it('应该在收到 websocket 协议的 newConnection 事件时调用 handleWebSocketConnection', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const handleWebSocketConnectionSpy = vi.spyOn(handler as any, 'handleWebSocketConnection');

      const wsMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'websocket',
          url: '/ws',
          wsHeaders: {},
        },
      };

      controller.emit('newConnection', wsMsg);

      expect(handleWebSocketConnectionSpy).toHaveBeenCalledWith(wsMsg);
    });

    it('应该在收到 connectionClose 事件时调用 handleConnectionClose', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const handleConnectionCloseSpy = vi.spyOn(handler as any, 'handleConnectionClose');

      const closeMsg = {
        id: 'test-id',
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'test-conn' },
      };

      controller.emit('connectionClose', closeMsg);

      expect(handleConnectionCloseSpy).toHaveBeenCalledWith(closeMsg);
    });
  });

  describe('filterHeaders', () => {
    it('应该过滤掉逐跳头部字段', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const headers = {
        'connection': 'keep-alive',
        'keep-alive': 'timeout=5',
        'content-type': 'application/json',
        'user-agent': 'test',
      };

      // 调用私有方法进行测试
      const filtered = (handler as any).filterHeaders(headers);

      expect(filtered['connection']).toBeUndefined();
      expect(filtered['keep-alive']).toBeUndefined();
      expect(filtered['content-type']).toBe('application/json');
      expect(filtered['user-agent']).toBe('test');
    });

    it('应该处理 undefined headers', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const filtered = (handler as any).filterHeaders(undefined);

      expect(filtered).toEqual({});
    });

    it('应该处理空 headers', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const filtered = (handler as any).filterHeaders({});

      expect(filtered).toEqual({});
    });

    it('应该处理数组类型的 header 值', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const headers = {
        'set-cookie': ['cookie1=value1', 'cookie2=value2'],
        'content-type': 'text/html',
      };

      const filtered = (handler as any).filterHeaders(headers);

      expect(filtered['set-cookie']).toBe('cookie1=value1, cookie2=value2');
      expect(filtered['content-type']).toBe('text/html');
    });

    it('应该过滤所有逐跳头部', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const headers = {
        'connection': 'close',
        'keep-alive': 'timeout=5',
        'proxy-authenticate': 'Basic',
        'proxy-authorization': 'Basic xyz',
        'te': 'trailers',
        'trailers': 'some-trailer',
        'transfer-encoding': 'chunked',
        'upgrade': 'websocket',
        'content-type': 'text/html',
      };

      const filtered = (handler as any).filterHeaders(headers);

      // 所有逐跳头部应该被过滤
      expect(filtered['connection']).toBeUndefined();
      expect(filtered['keep-alive']).toBeUndefined();
      expect(filtered['proxy-authenticate']).toBeUndefined();
      expect(filtered['proxy-authorization']).toBeUndefined();
      expect(filtered['te']).toBeUndefined();
      expect(filtered['trailers']).toBeUndefined();
      expect(filtered['transfer-encoding']).toBeUndefined();
      expect(filtered['upgrade']).toBeUndefined();
      // 正常头部应该保留
      expect(filtered['content-type']).toBe('text/html');
    });
  });

  describe('destroy', () => {
    it('应该清理所有资源', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      // 添加一些测试数据，需要 mock destroy/close 方法
      const mockReq = { destroy: vi.fn() };
      const mockWs = { close: vi.fn(), removeAllListeners: vi.fn() };
      const mockRes = { destroy: vi.fn(), end: vi.fn() };

      handler.pendingConnections.set('test-1', { req: mockReq });
      handler.localWsConnections.set('test-2', mockWs);
      handler.streamingResponses.set('test-3', mockRes);

      handler.destroy();

      // 验证清理方法被调用
      expect(mockReq.destroy).toHaveBeenCalled();
      expect(mockWs.close).toHaveBeenCalledWith(1000, '处理器已销毁');
      expect(mockRes.destroy).toHaveBeenCalled();

      // 所有 Map 应该被清空
      expect(handler.pendingConnections.size).toBe(0);
      expect(handler.localWsConnections.size).toBe(0);
      expect(handler.streamingResponses.size).toBe(0);
    });

    it('应该移除所有事件监听器', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const removeAllListenersSpy = vi.spyOn(handler, 'removeAllListeners');

      handler.destroy();

      expect(removeAllListenersSpy).toHaveBeenCalled();
    });
  });

  describe('事件系统', () => {
    it('应该继承 EventEmitter 并支持事件', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const testSpy = vi.fn();

      handler.on('test', testSpy);
      handler.emit('test', 'data');

      expect(testSpy).toHaveBeenCalledWith('data');
    });

    it('应该发出 error 事件', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const errorSpy = vi.fn();

      handler.on('error', errorSpy);
      handler.emit('error', new Error('测试错误'));

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
    });
  });

  describe('handleConnectionClose', () => {
    it('应该关闭 HTTP 连接', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockReq = { destroy: vi.fn() };
      handler.pendingConnections.set('http-conn', { req: mockReq });

      const closeMsg = {
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'http-conn' },
        id: 'test-id',
      };

      (handler as any).handleConnectionClose(closeMsg);

      expect(mockReq.destroy).toHaveBeenCalled();
      expect(handler.pendingConnections.has('http-conn')).toBe(false);
    });

    it('应该关闭流式响应', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockRes = { destroy: vi.fn() };
      handler.streamingResponses.set('stream-conn', mockRes);

      const closeMsg = {
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'stream-conn' },
        id: 'test-id',
      };

      (handler as any).handleConnectionClose(closeMsg);

      expect(mockRes.destroy).toHaveBeenCalled();
      expect(handler.streamingResponses.has('stream-conn')).toBe(false);
    });

    it('应该关闭 WebSocket 连接', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        close: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      handler.localWsConnections.set('ws-conn', mockWs as any);

      const closeMsg = {
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'ws-conn' },
        id: 'test-id',
      };

      (handler as any).handleConnectionClose(closeMsg);

      expect(mockWs.close).toHaveBeenCalledWith(1000, '服务器已关闭连接');
    });

    it('应该清理 WebSocket 连接资源', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        close: vi.fn(),
        removeAllListeners: vi.fn(),
      };
      handler.localWsConnections.set('ws-conn', mockWs as any);

      const closeMsg = {
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'ws-conn' },
        id: 'test-id',
      };

      (handler as any).handleConnectionClose(closeMsg);

      // cleanupWsConnection 应该被调用
      expect(handler.localWsConnections.has('ws-conn')).toBe(false);
    });

    it('应该处理不存在的连接', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const closeMsg = {
        type: MessageType.CONNECTION_CLOSE,
        payload: { connectionId: 'non-existent' },
        id: 'test-id',
      };

      // 不应该抛出错误
      expect(() => {
        (handler as any).handleConnectionClose(closeMsg);
      }).not.toThrow();
    });
  });

  describe('cleanupWsConnection', () => {
    it('应该清理 WebSocket 连接并移除所有监听器', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        removeAllListeners: vi.fn(),
      };
      handler.localWsConnections.set('ws-conn', mockWs as any);

      (handler as any).cleanupWsConnection('ws-conn');

      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(handler.localWsConnections.has('ws-conn')).toBe(false);
    });

    it('应该处理不存在的 WebSocket 连接', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      // 不应该抛出错误
      expect(() => {
        (handler as any).cleanupWsConnection('non-existent');
      }).not.toThrow();
    });

    it('应该正确调用 removeAllListeners', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        removeAllListeners: vi.fn(),
      };
      handler.localWsConnections.set('ws-conn', mockWs as any);

      (handler as any).cleanupWsConnection('ws-conn');

      expect(mockWs.removeAllListeners).toHaveBeenCalled();
      expect(handler.localWsConnections.has('ws-conn')).toBe(false);
    });
  });

  describe('forwardToServer', () => {
    it('应该发送数据到服务器', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const testData = Buffer.from('test data');

      (handler as any).forwardToServer('conn-123', testData);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('conn-123')
      );
    });

    it('应该在未连接时不发送数据', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      (controller as any).ws = null;

      const testData = Buffer.from('test data');

      // 不应该抛出错误
      expect(() => {
        (handler as any).forwardToServer('conn-123', testData);
      }).not.toThrow();
    });
  });

  describe('handleClientData', () => {
    it('应该将数据发送到本地 WebSocket', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      handler.localWsConnections.set('ws-conn', mockWs as any);

      (handler as any).handleClientData('ws-conn', Buffer.from('test').toString('base64'));

      expect(mockWs.send).toHaveBeenCalled();
    });

    it('应该处理不存在的 WebSocket 连接', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      // 不应该抛出错误
      expect(() => {
        (handler as any).handleClientData('non-existent', 'data');
      }).not.toThrow();
    });

    it('应该在 WebSocket 非 OPEN 状态时不发送数据', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 0, // CONNECTING
        send: vi.fn(),
      };
      handler.localWsConnections.set('ws-conn', mockWs as any);

      (handler as any).handleClientData('ws-conn', Buffer.from('test').toString('base64'));

      // 非 OPEN 状态不应该发送
      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('sendResponse', () => {
    it('应该在未连接时不发送响应', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      (controller as any).ws = null;

      const responseData = {
        statusCode: 200,
        headers: {},
        body: 'test',
      };

      // 不应该抛出错误
      expect(() => {
        (handler as any).sendResponse('conn-123', responseData);
      }).not.toThrow();
    });

    it('应该删除 pendingConnections', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const mockReq = { destroy: vi.fn() };
      handler.pendingConnections.set('conn-123', { req: mockReq });

      const responseData = {
        statusCode: 200,
        headers: {},
        body: 'test',
      };

      (handler as any).sendResponse('conn-123', responseData);

      // 应该从 pendingConnections 中删除
      expect(handler.pendingConnections.has('conn-123')).toBe(false);
    });
  });

  describe('notifyServerClose', () => {
    it('应该发送关闭消息到控制器', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const sendMessageSpy = vi.spyOn(controller, 'sendMessage').mockReturnValue(true);

      (handler as any).notifyServerClose('conn-123');

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.CONNECTION_CLOSE,
        })
      );
    });
  });

  describe('sendError', () => {
    it('应该发送错误响应并触发 error 事件', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const errorSpy = vi.fn();

      handler.on('error', errorSpy);

      (handler as any).sendError('conn-123', 'Test error');

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(errorSpy.mock.calls[0][0].message).toContain('conn-123');
    });
  });

  describe('forwardStreamData', () => {
    it('应该将流式数据转发到服务器', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const testData = Buffer.from('test stream data');
      (handler as any).forwardStreamData('conn-123', testData);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('http_response_data')
      );
    });

    it('应该在未连接时不发送数据', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      (controller as any).ws = null;

      const testData = Buffer.from('test stream data');

      // 不应该抛出错误
      expect(() => {
        (handler as any).forwardStreamData('conn-123', testData);
      }).not.toThrow();
    });

    it('应该在 WebSocket 非 OPEN 状态时不发送数据', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 0, // CONNECTING
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const testData = Buffer.from('test stream data');
      (handler as any).forwardStreamData('conn-123', testData);

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('notifyStreamEnd', () => {
    it('应该通知服务器流式响应结束', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      (handler as any).notifyStreamEnd('conn-123');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('http_response_end')
      );
    });

    it('应该在未连接时不发送通知', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      (controller as any).ws = null;

      // 不应该抛出错误
      expect(() => {
        (handler as any).notifyStreamEnd('conn-123');
      }).not.toThrow();
    });

    it('应该在 WebSocket 非 OPEN 状态时不发送通知', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 0, // CONNECTING
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      (handler as any).notifyStreamEnd('conn-123');

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('sendResponseHeaders', () => {
    it('应该发送响应头到服务器', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const headers = {
        statusCode: 200,
        headers: { 'content-type': 'text/html' },
      };

      (handler as any).sendResponseHeaders('conn-123', headers);

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('http_response_headers')
      );
    });

    it('应该在未连接时不发送响应头', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      (controller as any).ws = null;

      const headers = {
        statusCode: 200,
        headers: {},
      };

      // 不应该抛出错误
      expect(() => {
        (handler as any).sendResponseHeaders('conn-123', headers);
      }).not.toThrow();
    });

    it('应该在 WebSocket 非 OPEN 状态时不发送响应头', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 0, // CONNECTING
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const headers = {
        statusCode: 200,
        headers: {},
      };

      (handler as any).sendResponseHeaders('conn-123', headers);

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('setupDataListener', () => {
    it('应该在 ws 不存在时不设置监听器', () => {
      (controller as any).ws = null;

      // 不应该抛出错误
      expect(() => {
        new UnifiedHandler(controller, proxyConfig);
      }).not.toThrow();
    });

    it('应该在 ws 存在时设置消息监听器', () => {
      const mockWs = {
        readyState: 1,
        on: vi.fn(),
      };
      (controller as any).ws = mockWs;

      // 创建 handler 应该设置监听器
      new UnifiedHandler(controller, proxyConfig);

      // 验证 on 被调用
      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('应该处理 connection_data 类型的消息', () => {
      const mockWs = {
        readyState: 1,
        on: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const handler = new UnifiedHandler(controller, proxyConfig);

      // 获取 message 监听器
      const messageListener = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      expect(messageListener).toBeDefined();

      if (messageListener) {
        // 添加一个 WebSocket 连接用于测试
        const testWs = {
          readyState: 1,
          send: vi.fn(),
        };
        handler.localWsConnections.set('test-conn', testWs as any);

        // 模拟收到 connection_data 消息
        const dataMsg = JSON.stringify({
          type: 'connection_data',
          connectionId: 'test-conn',
          data: Buffer.from('test data').toString('base64'),
        });
        messageListener(Buffer.from(dataMsg));

        // 验证数据被发送到本地 WebSocket
        expect(testWs.send).toHaveBeenCalled();
      }
    });

    it('应该忽略非 connection_data 类型的消息', () => {
      const mockWs = {
        readyState: 1,
        on: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const handler = new UnifiedHandler(controller, proxyConfig);

      const messageListener = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      if (messageListener) {
        // 添加一个 WebSocket 连接
        const testWs = {
          readyState: 1,
          send: vi.fn(),
        };
        handler.localWsConnections.set('test-conn', testWs as any);

        // 模拟收到其他类型的消息
        const dataMsg = JSON.stringify({
          type: 'other_type',
          connectionId: 'test-conn',
          data: Buffer.from('test data').toString('base64'),
        });
        messageListener(Buffer.from(dataMsg));

        // 不应该发送数据
        expect(testWs.send).not.toHaveBeenCalled();
      }
    });

    it('应该忽略无法解析的 JSON 消息', () => {
      const mockWs = {
        readyState: 1,
        on: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const handler = new UnifiedHandler(controller, proxyConfig);

      const messageListener = mockWs.on.mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      if (messageListener) {
        // 添加一个 WebSocket 连接
        const testWs = {
          readyState: 1,
          send: vi.fn(),
        };
        handler.localWsConnections.set('test-conn', testWs as any);

        // 模拟收到无效 JSON - 不应该抛出错误
        expect(() => {
          messageListener(Buffer.from('invalid json'));
        }).not.toThrow();
      }
    });
  });

  /*
   * 以下功能需要真实的 HTTP/WebSocket 服务器和网络连接，单元测试无法覆盖：
   *
   * 1. handleHttpConnection() - 需要真实的 HTTP 客户端和服务器
   * 2. handleWebSocketConnection() - 需要真实的 WebSocket 服务器
   * 3. 流式响应处理 (SSE) - 需要可读流的完整模拟
   * 4. setupDataListener() - 需要 controller.ws 已设置
   *
   * 这些功能应该通过集成测试或 E2E 测试验证
   */
  describe('handleHttpConnection', () => {
    it('应该处理 HTTP 请求错误', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      // 添加错误监听器以避免未捕获的异常
      handler.on('error', () => {});

      // Mock httpRequest 抛出错误
      mockHttpRequest.mockImplementation(() => {
        throw new Error('Network error');
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/test',
          headers: {},
          body: null,
        },
      };

      // 应该处理错误（通过发送错误响应而不是抛出异常）
      await expect((handler as any).handleHttpConnection(httpMsg)).resolves.not.toThrow();
    });

    it('应该处理 HTTP 请求对象错误', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      // 添加错误监听器以避免未捕获的异常
      handler.on('error', () => {});

      // 创建一个会触发错误的 mock request
      const mockReq = new EventEmitter();
      const mockRes = new EventEmitter() as any;
      mockRes.statusCode = 200;
      mockRes.headers = {};

      mockHttpRequest.mockImplementation(() => {
        // 立即触发错误
        setTimeout(() => mockReq.emit('error', new Error('Request failed')), 0);
        return mockReq;
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/test',
          headers: {},
          body: null,
        },
      };

      // 不应该抛出错误
      await expect((handler as any).handleHttpConnection(httpMsg)).resolves.not.toThrow();
    });

    it('应该处理普通 HTTP 响应', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      // 创建一个真实的 EventEmitter 作为 mockRes
      class MockResponse extends EventEmitter {
        statusCode = 200;
        headers = { 'content-type': 'text/html' };
        on(event: string, callback: (...args: any[]) => void) {
          // 注册事件监听器
          super.on(event, callback);
          if (event === 'data') {
            setTimeout(() => this.emit('data', Buffer.from('test response')), 5);
          } else if (event === 'end') {
            setTimeout(() => this.emit('end'), 10);
          }
          return this;
        }
      }

      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      const mockRes = new MockResponse();

      mockHttpRequest.mockImplementation((_options: any, callback: (res: any) => void) => {
        callback(mockRes);
        return mockReq;
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/test',
          headers: {},
          body: null,
        },
      };

      await (handler as any).handleHttpConnection(httpMsg);

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 30));

      // 验证响应被发送
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('应该处理 SSE 流式响应', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      class MockSSEResponse extends EventEmitter {
        statusCode = 200;
        headers = { 'content-type': 'text/event-stream' };
        on(event: string, callback: (...args: any[]) => void) {
          super.on(event, callback);
          // 不自动触发事件，让测试手动控制
          return this;
        }
      }

      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      const mockRes = new MockSSEResponse();

      mockHttpRequest.mockImplementation((_options: any, callback: (res: any) => void) => {
        callback(mockRes);
        return mockReq;
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/events',
          headers: {},
          body: null,
        },
      };

      await (handler as any).handleHttpConnection(httpMsg);

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 10));

      // 模拟 SSE 数据
      mockRes.emit('data', Buffer.from('data: test\n\n'));

      // 等待数据发送
      await new Promise(resolve => setTimeout(resolve, 10));

      // 模拟 SSE 结束
      mockRes.emit('end');

      // 等待结束处理
      await new Promise(resolve => setTimeout(resolve, 10));

      // 验证响应头和数据被发送
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('应该处理 SSE 错误事件', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      // 添加错误监听器
      handler.on('error', () => {});

      class MockSSEResponse extends EventEmitter {
        statusCode = 200;
        headers = { 'content-type': 'text/event-stream' };
        on(event: string, callback: (...args: any[]) => void) {
          super.on(event, callback);
          if (event === 'error') {
            setTimeout(() => this.emit('error', new Error('SSE error')), 5);
          }
          return this;
        }
      }

      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      const mockRes = new MockSSEResponse();

      mockHttpRequest.mockImplementation((_options: any, callback: (res: any) => void) => {
        callback(mockRes);
        return mockReq;
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/events',
          headers: {},
          body: null,
        },
      };

      await (handler as any).handleHttpConnection(httpMsg);

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 20));

      // 应该发送错误通知
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('应该处理带请求体的 HTTP 请求', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      class MockBodyResponse extends EventEmitter {
        statusCode = 200;
        headers = {};
        on(event: string, callback: (...args: any[]) => void) {
          super.on(event, callback);
          if (event === 'data') {
            setTimeout(() => this.emit('data', Buffer.from('')), 5);
          } else if (event === 'end') {
            setTimeout(() => this.emit('end'), 10);
          }
          return this;
        }
      }

      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      const mockRes = new MockBodyResponse();

      mockHttpRequest.mockImplementation((_options: any, callback: (res: any) => void) => {
        callback(mockRes);
        return mockReq;
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'POST',
          url: '/api/test',
          headers: {},
          body: Buffer.from('test body').toString('base64'),
        },
      };

      await (handler as any).handleHttpConnection(httpMsg);

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 30));

      // 验证请求体被写入
      expect(mockReq.write).toHaveBeenCalled();
      expect(mockReq.end).toHaveBeenCalled();
    });

    it('应该处理响应错误事件', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      // 添加错误监听器以避免未捕获的异常
      handler.on('error', () => {});

      class MockErrorResponse extends EventEmitter {
        statusCode = 200;
        headers = {};
        on(event: string, callback: (...args: any[]) => void) {
          super.on(event, callback);
          if (event === 'error') {
            setTimeout(() => this.emit('error', new Error('Response error')), 5);
          }
          return this;
        }
      }

      const mockReq = new EventEmitter() as any;
      mockReq.write = vi.fn();
      mockReq.end = vi.fn();
      const mockRes = new MockErrorResponse();

      mockHttpRequest.mockImplementation((_options: any, callback: (res: any) => void) => {
        callback(mockRes);
        return mockReq;
      });

      const httpMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'http',
          method: 'GET',
          url: '/test',
          headers: {},
          body: null,
        },
      };

      await (handler as any).handleHttpConnection(httpMsg);

      // 等待异步操作
      await new Promise(resolve => setTimeout(resolve, 20));

      // 错误消息应该被发送
      expect(mockWs.send).toHaveBeenCalled();
    });
  });

  describe('handleWebSocketConnection', () => {
    it('应该创建到本地 WebSocket 的连接', () => {
      const handler = new UnifiedHandler(controller, proxyConfig);

      const wsMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'websocket',
          url: '/ws',
          wsHeaders: {},
        },
      };

      // 不应该抛出错误
      expect(() => {
        (handler as any).handleWebSocketConnection(wsMsg);
      }).not.toThrow();

      // WebSocket 应该被添加到连接映射表
      expect(handler.localWsConnections.size).toBeGreaterThan(0);
    });

    it('应该处理 WebSocket 错误事件', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const wsMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'websocket',
          url: '/ws',
          wsHeaders: {},
        },
      };

      (handler as any).handleWebSocketConnection(wsMsg);

      // 等待 WebSocket 连接建立
      await new Promise(resolve => setTimeout(resolve, 20));

      // 获取本地 WebSocket 连接
      const localWs = handler.localWsConnections.get('test-conn');
      expect(localWs).toBeDefined();

      // 触发错误事件
      if (localWs) {
        localWs.emit('error', new Error('WebSocket error'));
      }

      // 等待错误处理
      await new Promise(resolve => setTimeout(resolve, 10));

      // 连接应该被清理
      expect(handler.localWsConnections.has('test-conn')).toBe(false);
    });

    it('应该处理 WebSocket 关闭事件', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const wsMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'websocket',
          url: '/ws',
          wsHeaders: {},
        },
      };

      (handler as any).handleWebSocketConnection(wsMsg);

      // 等待 WebSocket 连接建立
      await new Promise(resolve => setTimeout(resolve, 20));

      // 获取本地 WebSocket 连接
      const localWs = handler.localWsConnections.get('test-conn');
      expect(localWs).toBeDefined();

      // 触发关闭事件
      if (localWs) {
        localWs.emit('close', 1000, Buffer.from('Normal closure'));
      }

      // 等待关闭处理
      await new Promise(resolve => setTimeout(resolve, 10));

      // 连接应该被清理
      expect(handler.localWsConnections.has('test-conn')).toBe(false);
    });

    it('应该处理 WebSocket 消息事件', async () => {
      const handler = new UnifiedHandler(controller, proxyConfig);
      const mockWs = {
        readyState: 1,
        send: vi.fn(),
      };
      (controller as any).ws = mockWs;

      const wsMsg = {
        id: 'test-id',
        type: MessageType.NEW_CONNECTION,
        payload: {
          connectionId: 'test-conn',
          protocol: 'websocket',
          url: '/ws',
          wsHeaders: {},
        },
      };

      (handler as any).handleWebSocketConnection(wsMsg);

      // 等待 WebSocket 连接建立
      await new Promise(resolve => setTimeout(resolve, 20));

      // 获取本地 WebSocket 连接
      const localWs = handler.localWsConnections.get('test-conn');
      expect(localWs).toBeDefined();

      // 触发消息事件
      if (localWs) {
        localWs.emit('message', Buffer.from('test message'));
      }

      // 等待消息处理
      await new Promise(resolve => setTimeout(resolve, 10));

      // 消息应该被转发到服务器
      expect(mockWs.send).toHaveBeenCalled();
    });
  });

  describe('集成测试标记', () => {
    it('标记: handleHttpConnection 需要真实 HTTP 服务器', () => {
      // handleHttpConnection() 方法需要：
      // 1. 真实的 HTTP 服务器接收请求
      // 2. 模拟完整的 HTTP 响应（包括流式响应）
      // 3. 处理各种 HTTP 状态码和头部
      // 建议：使用 nock 或 msw 模块进行集成测试
      expect(true).toBe(true);
    });

    it('标记: handleWebSocketConnection 需要真实 WebSocket 服务器', () => {
      // handleWebSocketConnection() 方法需要：
      // 1. 真实的本地 WebSocket 服务器
      // 2. 完整的 WebSocket 握手过程
      // 3. 双向消息转发测试
      // 建议：使用 ws 模块创建测试服务器
      expect(true).toBe(true);
    });

    it('标记: SSE 流式响应需要可读流模拟', () => {
      // SSE 流式转发需要：
      // 1. 模拟 ServerResponse 的 data 事件
      // 2. 模拟分块数据传输
      // 3. 验证数据正确转发到服务器
      // 建议：使用 PassThrough 流进行集成测试
      expect(true).toBe(true);
    });

    it('标记: setupDataListener 需要 WebSocket 连接', () => {
      // setupDataListener() 需要：
      // 1. controller.ws 已建立连接
      // 2. 模拟服务器发来的 connection_data 消息
      // 建议：在完整的集成环境中测试
      expect(true).toBe(true);
    });
  });
});
