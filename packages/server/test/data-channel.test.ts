/**
 * @module data-channel.test
 * @description 服务端数据通道管理器的单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { DataChannelManager } from '../src/data-channel.js';
import { SessionManager } from '../src/session-manager.js';
import {
  writeTcpAuthFrame,
  writeUdpRegisterFrame,
  writeUdpKeepaliveFrame,
  writeUdpDataFrame,
  writeDataFrame,
  AUTH_RESPONSE,
} from '@feng3d/chuantou-shared';

describe('DataChannelManager', () => {
  let sessionManager: SessionManager;
  let dcm: DataChannelManager;
  let clientId: string;
  let mockWs: any;

  beforeEach(() => {
    vi.clearAllMocks();

    sessionManager = new SessionManager(30000, 120000);

    mockWs = new EventEmitter();
    mockWs.readyState = 1;
    mockWs.send = vi.fn();

    clientId = sessionManager.createSession(mockWs as any);
    sessionManager.authenticateClient(clientId);

    dcm = new DataChannelManager(sessionManager);
  });

  afterEach(() => {
    dcm.clear();
    sessionManager.clear();
  });

  describe('sendToClient', () => {
    it('无数据通道时应返回 false', () => {
      const result = dcm.sendToClient(clientId, 'conn-1', Buffer.from('data'));
      expect(result).toBe(false);
    });

    it('有数据通道时应返回 socket.write 的返回值', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroyed = false;
      mockSocket.write = vi.fn().mockReturnValue(true);
      mockSocket.destroy = vi.fn();
      (dcm as any).tcpChannels.set(clientId, mockSocket);

      const result = dcm.sendToClient(clientId, 'conn-1', Buffer.from('data'));
      expect(result).toBe(true);
      expect(mockSocket.write).toHaveBeenCalled();
    });

    it('socket.write 返回 false 时 sendToClient 应返回 false', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroyed = false;
      mockSocket.write = vi.fn().mockReturnValue(false);
      mockSocket.destroy = vi.fn();
      (dcm as any).tcpChannels.set(clientId, mockSocket);

      const result = dcm.sendToClient(clientId, 'conn-1', Buffer.from('data'));
      expect(result).toBe(false);
    });

    it('socket 已销毁时应返回 false', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroyed = true;
      mockSocket.write = vi.fn();
      mockSocket.destroy = vi.fn();
      (dcm as any).tcpChannels.set(clientId, mockSocket);

      const result = dcm.sendToClient(clientId, 'conn-1', Buffer.from('data'));
      expect(result).toBe(false);
      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  describe('getClientTcpSocket', () => {
    it('无数据通道时应返回 null', () => {
      expect(dcm.getClientTcpSocket(clientId)).toBeNull();
    });

    it('有数据通道时应返回 socket', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroyed = false;
      mockSocket.destroy = vi.fn();
      (dcm as any).tcpChannels.set(clientId, mockSocket);

      expect(dcm.getClientTcpSocket(clientId)).toBe(mockSocket);
    });

    it('socket 已销毁时应返回 null', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroyed = true;
      mockSocket.destroy = vi.fn();
      (dcm as any).tcpChannels.set(clientId, mockSocket);

      expect(dcm.getClientTcpSocket(clientId)).toBeNull();
    });

    it('不存在的 clientId 应返回 null', () => {
      expect(dcm.getClientTcpSocket('non-existent')).toBeNull();
    });
  });

  describe('UDP 反向索引', () => {
    const rinfo1 = { address: '10.0.0.1', port: 5000, family: 'IPv4', size: 100 };
    const rinfo2 = { address: '10.0.0.2', port: 6000, family: 'IPv4', size: 100 };

    it('注册后应能通过反向索引 O(1) 查找客户端', () => {
      // 设置 mock UDP socket
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      // 发送注册帧
      const registerFrame = writeUdpRegisterFrame(clientId);
      dcm.handleUdpMessage(registerFrame, rinfo1 as any);

      // 验证反向索引已建立
      expect((dcm as any).udpClientIndex.get('10.0.0.1:5000')).toBe(clientId);
    });

    it('数据帧应能通过反向索引匹配客户端并触发事件', () => {
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      // 先注册
      dcm.handleUdpMessage(writeUdpRegisterFrame(clientId), rinfo1 as any);

      // 监听数据事件
      const events: any[] = [];
      dcm.on('udpData', (cId: string, connId: string, data: Buffer) => {
        events.push({ clientId: cId, connectionId: connId, data });
      });

      // 发送数据帧
      const connId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const dataFrame = writeUdpDataFrame(connId, Buffer.from('test-data'));
      dcm.handleUdpMessage(dataFrame, rinfo1 as any);

      expect(events.length).toBe(1);
      expect(events[0].clientId).toBe(clientId);
      expect(events[0].connectionId).toBe(connId);
    });

    it('keepalive 应更新反向索引（NAT 地址变更）', () => {
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      // 注册初始地址
      dcm.handleUdpMessage(writeUdpRegisterFrame(clientId), rinfo1 as any);
      expect((dcm as any).udpClientIndex.get('10.0.0.1:5000')).toBe(clientId);

      // keepalive 使用新地址
      dcm.handleUdpMessage(writeUdpKeepaliveFrame(clientId), rinfo2 as any);

      // 旧地址应已删除
      expect((dcm as any).udpClientIndex.has('10.0.0.1:5000')).toBe(false);
      // 新地址应已建立
      expect((dcm as any).udpClientIndex.get('10.0.0.2:6000')).toBe(clientId);
    });

    it('未注册的来源发送数据帧应不触发事件', () => {
      const events: any[] = [];
      dcm.on('udpData', (cId: string, connId: string, data: Buffer) => {
        events.push({ clientId: cId, connectionId: connId, data });
      });

      const connId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const dataFrame = writeUdpDataFrame(connId, Buffer.from('unknown'));
      dcm.handleUdpMessage(dataFrame, rinfo1 as any);

      expect(events.length).toBe(0);
    });

    it('removeClient 应清理反向索引', () => {
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      dcm.handleUdpMessage(writeUdpRegisterFrame(clientId), rinfo1 as any);
      expect((dcm as any).udpClientIndex.size).toBe(1);

      dcm.removeClient(clientId);

      expect((dcm as any).udpClientIndex.size).toBe(0);
      expect((dcm as any).udpClients.has(clientId)).toBe(false);
    });

    it('clear 应清理所有反向索引', () => {
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      dcm.handleUdpMessage(writeUdpRegisterFrame(clientId), rinfo1 as any);

      dcm.clear();

      expect((dcm as any).udpClientIndex.size).toBe(0);
      expect((dcm as any).udpClients.size).toBe(0);
    });

    it('重复注册应更新反向索引', () => {
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      // 第一次注册
      dcm.handleUdpMessage(writeUdpRegisterFrame(clientId), rinfo1 as any);
      expect((dcm as any).udpClientIndex.get('10.0.0.1:5000')).toBe(clientId);

      // 第二次注册（地址变更）
      dcm.handleUdpMessage(writeUdpRegisterFrame(clientId), rinfo2 as any);

      // 旧地址应被移除
      expect((dcm as any).udpClientIndex.has('10.0.0.1:5000')).toBe(false);
      // 新地址已建立
      expect((dcm as any).udpClientIndex.get('10.0.0.2:6000')).toBe(clientId);
    });
  });

  describe('handleNewTcpConnection', () => {
    it('无效认证帧应拒绝', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.write = vi.fn();
      mockSocket.destroy = vi.fn();

      dcm.handleNewTcpConnection(mockSocket, Buffer.from('invalid'));

      expect(mockSocket.write).toHaveBeenCalledWith(AUTH_RESPONSE.FAILURE);
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('未认证客户端应拒绝', () => {
      const unauthId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const mockSocket = new EventEmitter() as any;
      mockSocket.write = vi.fn();
      mockSocket.destroy = vi.fn();

      dcm.handleNewTcpConnection(mockSocket, writeTcpAuthFrame(unauthId));

      expect(mockSocket.write).toHaveBeenCalledWith(AUTH_RESPONSE.FAILURE);
      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it('认证成功应建立数据通道', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.write = vi.fn();
      mockSocket.destroy = vi.fn();
      mockSocket.destroyed = false;

      dcm.handleNewTcpConnection(mockSocket, writeTcpAuthFrame(clientId));

      expect(mockSocket.write).toHaveBeenCalledWith(AUTH_RESPONSE.SUCCESS);
      expect(dcm.hasDataChannel(clientId)).toBe(true);
    });
  });

  describe('hasDataChannel / hasUdpChannel', () => {
    it('无通道时应返回 false', () => {
      expect(dcm.hasDataChannel(clientId)).toBe(false);
      expect(dcm.hasUdpChannel(clientId)).toBe(false);
    });

    it('建立 TCP 通道后应返回 true', () => {
      const mockSocket = new EventEmitter() as any;
      mockSocket.destroyed = false;
      mockSocket.destroy = vi.fn();
      (dcm as any).tcpChannels.set(clientId, mockSocket);

      expect(dcm.hasDataChannel(clientId)).toBe(true);
    });

    it('注册 UDP 后应返回 true', () => {
      const mockUdpSocket = { send: vi.fn() } as any;
      dcm.setUdpSocket(mockUdpSocket);

      dcm.handleUdpMessage(
        writeUdpRegisterFrame(clientId),
        { address: '10.0.0.1', port: 5000, family: 'IPv4', size: 100 } as any,
      );

      expect(dcm.hasUdpChannel(clientId)).toBe(true);
    });
  });
});
