/**
 * @module admin-server.test
 * @description 管理服务器模块的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AdminServer, ClientStatus } from '../src/admin-server.js';
import { ProxyConfig } from '@feng3d/chuantou-shared';
import { createServer } from 'http';

// Mock http module
vi.mock('http', () => ({
  createServer: vi.fn(),
}));

describe('AdminServer', () => {
  let mockServer: any;
  let getStatusCallback: () => ClientStatus;
  let addProxyCallback: vi.Mock;
  let removeProxyCallback: vi.Mock;

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建 mock server
    mockServer = {
      listen: vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      }),
      on: vi.fn(),
      close: vi.fn((cb: () => void) => cb()),
    };

    vi.mocked(createServer).mockReturnValue(mockServer);

    getStatusCallback = () => ({
      running: true,
      serverUrl: 'ws://localhost:9000',
      connected: true,
      authenticated: true,
      uptime: 60000,
      proxies: [
        { remotePort: 8080, localPort: 3000, localHost: 'localhost' },
      ],
      reconnectAttempts: 0,
    });

    addProxyCallback = vi.fn().mockResolvedValue(undefined);
    removeProxyCallback = vi.fn().mockResolvedValue(undefined);
  });

  describe('constructor', () => {
    it('should create an admin server instance', () => {
      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      expect(adminServer).toBeInstanceOf(AdminServer);
      expect(createServer).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('start', () => {
    it('should start the server successfully', async () => {
      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      await expect(adminServer.start()).resolves.not.toThrow();
      expect(mockServer.listen).toHaveBeenCalledWith(9001, '127.0.0.1', expect.any(Function));
    });

    it('should handle server errors', async () => {
      const errorServer = {
        listen: vi.fn((port: number, host: string, cb: () => void) => {
          // 立即触发错误
          return errorServer;
        }),
        on: vi.fn((event: string, cb: (error: Error) => void) => {
          if (event === 'error') {
            cb(new Error('Port in use'));
          }
        }),
        close: vi.fn(),
      };

      vi.mocked(createServer).mockReturnValue(errorServer);

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      await expect(adminServer.start()).rejects.toThrow('Port in use');
    });
  });

  describe('stop', () => {
    it('should stop the server successfully', async () => {
      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      await adminServer.stop();

      expect(mockServer.close).toHaveBeenCalled();
    });
  });

  describe('handleRequest - status API', () => {
    it('should return status on GET /_ctc/status', () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      // 模拟请求
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      requestHandler!({ url: '/_ctc/status', method: 'GET' }, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('"running":true'));
    });
  });

  describe('handleRequest - add proxy API', () => {
    it('should handle POST /_ctc/proxies with valid data', async () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const newProxy: ProxyConfig = { remotePort: 8081, localPort: 3001, localHost: 'localhost' };
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      // 模拟带 req.on 的请求对象
      const mockReq = {
        url: '/_ctc/proxies',
        method: 'POST',
        on: vi.fn((event: string, callback: (data?: any) => void) => {
          if (event === 'data') {
            callback(JSON.stringify(newProxy));
          } else if (event === 'end') {
            // 异步处理结束
            setTimeout(() => callback(), 0);
          }
        }),
      };

      requestHandler!(mockReq, mockRes);

      // 等待异步处理
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(addProxyCallback).toHaveBeenCalledWith(newProxy);
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true }));
    });

    it('should handle POST /_ctc/proxies with invalid JSON', async () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      const mockReq = {
        url: '/_ctc/proxies',
        method: 'POST',
        on: vi.fn((event: string, callback: (data?: any) => void) => {
          if (event === 'data') {
            callback('invalid json');
          } else if (event === 'end') {
            setTimeout(() => callback(), 0);
          }
        }),
      };

      requestHandler!(mockReq, mockRes);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
    });

    it('should handle POST /_ctc/proxies when addProxyCallback throws', async () => {
      const failingAddProxy = vi.fn().mockRejectedValue(new Error('Port already in use'));

      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        failingAddProxy,
        removeProxyCallback
      );

      const newProxy: ProxyConfig = { remotePort: 8081, localPort: 3001, localHost: 'localhost' };
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      const mockReq = {
        url: '/_ctc/proxies',
        method: 'POST',
        on: vi.fn((event: string, callback: (data?: any) => void) => {
          if (event === 'data') {
            callback(JSON.stringify(newProxy));
          } else if (event === 'end') {
            setTimeout(() => callback(), 0);
          }
        }),
      };

      requestHandler!(mockReq, mockRes);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('Port already in use'));
    });
  });

  describe('handleRequest - delete proxy API', () => {
    it('should call removeProxyCallback on DELETE /_ctc/proxies/:port', async () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      // 模拟请求
      requestHandler!(
        { url: '/_ctc/proxies/8080', method: 'DELETE' },
        mockRes
      );

      // 等待异步处理
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(removeProxyCallback).toHaveBeenCalledWith(8080);
    });

    it('should return error for invalid port number', () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      // 模拟请求 - 无效端口
      requestHandler!(
        { url: '/_ctc/proxies/invalid', method: 'DELETE' },
        mockRes
      );

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('无效的端口号'));
    });

    it('should handle error when removeProxyCallback throws', async () => {
      const failingRemoveProxy = vi.fn().mockRejectedValue(new Error('删除失败'));

      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        failingRemoveProxy
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      requestHandler!(
        { url: '/_ctc/proxies/8080', method: 'DELETE' },
        mockRes
      );

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('删除失败'));
    });
  });

  describe('handleRequest - page', () => {
    it('should return HTML page on GET / when url is undefined', () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      // 模拟请求 - url 为 undefined 时应该默认为 '/'
      requestHandler!({ url: undefined, method: 'GET' }, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html; charset=utf-8' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
    });

    it('should return HTML page on GET /', () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      // 模拟请求
      requestHandler!({ url: '/', method: 'GET' }, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html; charset=utf-8' });
      expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('<!DOCTYPE html>'));
    });
  });

  describe('handleRequest - 404', () => {
    it('should return 404 for unknown routes', () => {
      let requestHandler: ((req: any, res: any) => void) | null = null;

      mockServer.listen = vi.fn((port: number, host: string, cb: () => void) => {
        cb();
        return mockServer;
      });
      mockServer.on = vi.fn();

      vi.mocked(createServer).mockImplementation((handler: any) => {
        requestHandler = handler;
        return mockServer;
      });

      const adminServer = new AdminServer(
        { port: 9001, host: '127.0.0.1' },
        getStatusCallback,
        addProxyCallback,
        removeProxyCallback
      );

      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };

      // 模拟请求
      requestHandler!({ url: '/unknown', method: 'GET' }, mockRes);

      expect(mockRes.writeHead).toHaveBeenCalledWith(404);
      expect(mockRes.end).toHaveBeenCalledWith('Not Found');
    });
  });
});
