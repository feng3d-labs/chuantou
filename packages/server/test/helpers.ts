/**
 * 服务器测试共享工具函数
 */

import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { MessageType, createMessage } from '@feng3d/chuantou-shared';

/**
 * 获取一个随机可用端口
 */
export async function getRandomPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * 连接 WebSocket 到指定地址
 */
export function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/**
 * 发送消息并等待响应
 */
export function sendAndWait(ws: WebSocket, msg: unknown, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待响应超时')), timeout);
    ws.once('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
    ws.send(JSON.stringify(msg));
  });
}

/**
 * 认证一个 WebSocket 连接，返回认证响应
 */
export async function authenticate(ws: WebSocket, token: string): Promise<any> {
  const msg = createMessage(MessageType.AUTH, { token });
  return sendAndWait(ws, msg);
}

/**
 * 等待指定毫秒
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
