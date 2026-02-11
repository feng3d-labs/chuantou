/**
 * ForwardServer 生命周期和 HTTP 端点测试
 * 测试服务器的启动、停止、状态查询和管理端点
 */

import { describe, it, expect, afterEach } from 'vitest';
import { request } from 'http';
import { ForwardServer } from '../src/server.js';
import { start, status, stop } from '../src/index.js';
import { getRandomPort, sleep } from './helpers.js';

describe('ForwardServer', () => {
  let server: ForwardServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
    // 等待端口释放
    await sleep(50);
  });

  describe('构造和配置', () => {
    it('应该使用默认配置创建实例', () => {
      server = new ForwardServer();
      const config = server.getConfig();

      expect(config.host).toBe('0.0.0.0');
      expect(config.controlPort).toBe(9000);
      expect(config.authTokens).toEqual([]);
      expect(config.heartbeatInterval).toBe(30000);
      expect(config.sessionTimeout).toBe(120000);
      expect(config.tls).toBeUndefined();
    });

    it('应该能用自定义配置覆盖默认值', () => {
      server = new ForwardServer({
        host: '127.0.0.1',
        controlPort: 8888,
        authTokens: ['test-token'],
      });
      const config = server.getConfig();

      expect(config.host).toBe('127.0.0.1');
      expect(config.controlPort).toBe(8888);
      expect(config.authTokens).toEqual(['test-token']);
      // 未指定的字段使用默认值
      expect(config.heartbeatInterval).toBe(30000);
    });

    it('getSessionManager应该返回SessionManager实例', () => {
      server = new ForwardServer();
      const sm = server.getSessionManager();

      expect(sm).toBeDefined();
      expect(typeof sm.createSession).toBe('function');
    });
  });

  describe('服务器生命周期', () => {
    it('应该能启动并监听指定端口', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();
      await sleep(50);

      const status = server.getStatus();
      expect(status.running).toBe(true);
      expect(status.controlPort).toBe(port);
    });

    it('getStatus在停止后应该报告running为false', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();
      await server.stop();

      const status = server.getStatus();
      expect(status.running).toBe(false);
      server = null; // 已停止，不需要afterEach再stop
    });

    it('uptime应该大于0在启动后', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();
      await sleep(50);

      const status = server.getStatus();
      expect(status.uptime).toBeGreaterThan(0);
    });

    it('getStatus应该反映正确的初始统计', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();

      const status = server.getStatus();
      expect(status.authenticatedClients).toBe(0);
      expect(status.totalPorts).toBe(0);
      expect(status.activeConnections).toBe(0);
      expect(status.tls).toBe(false);
    });
  });

  describe('HTTP管理端点', () => {
    /** 发起 HTTP 请求的辅助函数 */
    function httpRequest(port: number, method: string, path: string): Promise<{ statusCode: number; body: string }> {
      return new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port, method, path }, (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
        });
        req.on('error', reject);
        req.end();
      });
    }

    it('GET /_chuantou/status 应该返回JSON状态', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();
      await sleep(50);

      const res = await httpRequest(port, 'GET', '/_chuantou/status');
      expect(res.statusCode).toBe(200);

      const status = JSON.parse(res.body);
      expect(status.running).toBe(true);
      expect(status.controlPort).toBe(port);
      expect(typeof status.uptime).toBe('number');
    });

    it('POST /_chuantou/stop 应该停止服务器', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();
      await sleep(50);

      const res = await httpRequest(port, 'POST', '/_chuantou/stop');
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.message).toBe('服务器正在停止');

      await sleep(100);
      server = null; // 已通过endpoint停止
    });

    it('普通GET请求应该返回状态页面', async () => {
      const port = await getRandomPort();
      server = new ForwardServer({ controlPort: port, host: '127.0.0.1' });
      await server.start();
      await sleep(50);

      const res = await httpRequest(port, 'GET', '/');
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('feng3d-cts');
      expect(res.body).toContain('穿透服务器');
      expect(res.body).toContain('<!DOCTYPE html>');
    });
  });

  describe('start/status/stop便捷函数', () => {
    it('start()应该创建并启动服务器', async () => {
      const port = await getRandomPort();
      server = await start({ controlPort: port, host: '127.0.0.1' });
      await sleep(50);

      expect(server).toBeInstanceOf(ForwardServer);
      const s = status(server);
      expect(s.running).toBe(true);
    });

    it('status()应该返回服务器状态', async () => {
      const port = await getRandomPort();
      server = await start({ controlPort: port, host: '127.0.0.1' });

      const s = status(server);
      expect(s.controlPort).toBe(port);
      expect(s.host).toBe('127.0.0.1');
      expect(typeof s.uptime).toBe('number');
    });

    it('stop()应该停止服务器', async () => {
      const port = await getRandomPort();
      server = await start({ controlPort: port, host: '127.0.0.1' });
      await stop(server);

      const s = status(server);
      expect(s.running).toBe(false);
      server = null;
    });
  });
});
