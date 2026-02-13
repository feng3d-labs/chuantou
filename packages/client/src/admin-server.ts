/**
 * @module admin-server
 * @description 客户端管理页面 HTTP 服务器模块。
 * 提供一个本地 HTTP 服务，用于查看客户端状态和管理代理映射。
 * 支持反向代理模式和正向穿透模式。
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { exists, readFile } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ProxyConfig, ProxyConfigWithIndex, ForwardProxyEntry } from '@feng3d/chuantou-shared';

/**
 * 客户端状态信息接口
 */
export interface ClientStatus {
  /** 是否正在运行 */
  running: boolean;
  /** 服务器地址 */
  serverUrl: string;
  /** 是否已连接 */
  connected: boolean;
  /** 是否已认证 */
  authenticated: boolean;
  /** 运行时长（毫秒） */
  uptime: number;
  /** 已注册的代理列表 */
  proxies: ProxyConfig[];
  /** 重连次数 */
  reconnectAttempts: number;
  /** 正向穿透代理列表 */
  forwardProxies?: Array<{ localPort: number; targetClientId: string; targetPort: number }>;
  /** 客户端是否已注册到服务器（正向穿透模式） */
  isRegistered?: boolean;
  /** 当前客户端ID */
  clientId?: string;
}

/**
 * 管理页面服务器配置接口
 */
export interface AdminServerConfig {
  /** 监听端口 */
  port: number;
  /** 监听地址 */
  host: string;
}

/**
 * 管理页面服务器类
 *
 * 在本地启动一个 HTTP 服务器，提供状态查询和代理管理的 API 接口，
 * 以及一个可视化的 Web 管理界面。
 */
export class AdminServer {
  /** HTTP 服务器实例 */
  private server: ReturnType<typeof createServer>;
  /** 监听端口 */
  private port: number;
  /** 监听地址 */
  private host: string;
  /** 启动时间 */
  private startedAt: number;
  /** 获取状态回调函数 */
  private getStatusCallback: () => ClientStatus;
  /** 添加代理回调函数 */
  private addProxyCallback: (proxy: ProxyConfig) => Promise<void>;
  /** 删除代理回调函数 */
  private removeProxyCallback: (remotePort: number) => Promise<void>;
  /** 正向穿透代理列表（用于存储运行时的正向穿透配置） */
  private forwardProxies: Map<string, { localPort: number; targetClientId: string; targetPort: number }> = new Map();
  /** 发送消息到服务端的回调（用于正向穿透操作） */
  private sendMessageCallback?: (message: any) => Promise<any>;
  /** 添加正向穿透代理回调函数 */
  private addForwardProxyCallback?: (entry: ForwardProxyEntry) => Promise<void>;
  /** 删除正向穿透代理回调函数 */
  private removeForwardProxyCallback?: (localPort: number) => Promise<void>;
  /** 注册客户端回调函数 */
  private registerClientCallback?: (description?: string) => Promise<void>;
  /** 获取客户端列表回调函数 */
  private getClientListCallback?: () => Promise<any>;

  /**
   * 静态文件路径常量
   */
  private static readonly STATIC_DIR = join(dirname(import.meta.url || '.'), 'admin-ui', 'dist');

  /**
   * 状态页面 HTML 模板（保留作为备用）
   */
  private static readonly STATUS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>穿透客户端管理</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #e0e0e0;
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
      padding: 20px;
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .header h1 {
      font-size: 24px;
      margin-bottom: 16px;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .mode-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(0, 217, 255, 0.15);
      color: #00d9ff;
      margin-left: 8px;
    }
    .mode-badge.forward {
      background: rgba(255, 136, 0, 0.15);
      color: #ff8800;
    }
    .tabs {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 20px;
      background: rgba(255,255,255,0.05);
      border: none;
      border-radius: 8px;
      color: #888;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }
    .tab:hover {
      background: rgba(255,255,255,0.1);
    }
    .tab.active {
      background: rgba(0, 217, 255, 0.15);
      color: #00d9ff;
      border-color: rgba(0, 217, 255, 0.3);
    }
    .tab.active.forward-tab {
      background: rgba(255, 136, 0, 0.15);
      color: #ff8800;
      border-color: rgba(255, 136, 0, 0.3);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }
    .status.running {
      background: rgba(0, 255, 136, 0.15);
      color: #00ff88;
    }
    .status.running::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #00ff88;
      animation: pulse 1.5s infinite;
    }
    .status.stopped {
      background: rgba(255, 77, 77, 0.15);
      color: #ff4d4d;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 16px;
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
    }
    .card-label {
      font-size: 11px;
      color: #888;
      margin-bottom: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .card-value {
      font-size: 18px;
      font-weight: 600;
      color: #fff;
    }
    .card-value .unit {
      font-size: 12px;
      color: #888;
      font-weight: 400;
    }
    .proxies-section {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
      margin-top: 0;
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 13px;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .section-info {
      font-size: 12px;
      color: #666;
      margin-bottom: 12px;
      line-height: 1.6;
    }
    .section-info code {
      background: rgba(255,255,255,0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      color: #00d9ff;
    }
    .btn {
      padding: 8px 16px;
      border-radius: 8px;
      border: none;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #00d9ff, #00ff88);
      color: #000;
      font-weight: 500;
    }
    .btn-primary:hover {
      opacity: 0.9;
      transform: translateY(-1px);
    }
    .btn-primary.forward-btn {
      background: linear-gradient(135deg, #ff8800, #ffaa00);
    }
    .btn-danger {
      background: rgba(255, 77, 77, 0.2);
      color: #ff4d4d;
      padding: 4px 10px;
      font-size: 12px;
    }
    .btn-danger:hover {
      background: rgba(255, 77, 77, 0.3);
    }
    .btn-secondary {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }
    .btn-secondary:hover {
      background: rgba(255,255,255,0.15);
    }
    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
    }
    .proxy-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .proxy-item:last-child {
      margin-bottom: 0;
    }
    .proxy-item.forward-item {
      background: rgba(255, 136, 0, 0.1);
      border-left: 3px solid #ff8800;
    }
    .proxy-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
    }
    .proxy-index {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      background: rgba(255, 255, 255, 0.1);
      color: #aaa;
      min-width: 32px;
      text-align: center;
    }
    .proxy-protocol {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      background: rgba(0, 217, 255, 0.2);
      color: #00d9ff;
    }
    .proxy-item.forward-item .proxy-protocol {
      background: rgba(255, 136, 0, 0.2);
      color: #ff8800;
    }
    .proxy-remote, .proxy-local {
      font-family: monospace;
    }
    .proxy-remote {
      color: #00d9ff;
    }
    .proxy-item.forward-item .proxy-remote {
      color: #ff8800;
    }
    .proxy-arrow {
      color: #666;
    }
    .proxy-local {
      color: #888;
    }
    .empty-state {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 14px;
    }
    .add-form {
      display: none;
      background: rgba(0,0,0,0.3);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .add-form.forward-form {
      background: rgba(255, 136, 0, 0.1);
      border-left: 3px solid #ff8800;
    }
    .add-form.show {
      display: block;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)) auto;
      gap: 12px;
      align-items: end;
    }
    .form-row.forward-row {
      grid-template-columns: 1fr 1fr 1fr auto;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-size: 11px;
      color: #888;
      text-transform: uppercase;
    }
    .form-group input, .form-group select {
      padding: 10px 12px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      width: 100%;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none;
      border-color: #00d9ff;
    }
    .form-group select {
      cursor: pointer;
    }
    .form-actions {
      display: flex;
      gap: 8px;
    }
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal.show {
      display: flex;
    }
    .modal-content {
      background: #1a1a2e;
      border-radius: 16px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .modal-title {
      font-size: 16px;
      margin-bottom: 16px;
      font-weight: 600;
    }
    .modal-body {
      color: #888;
      font-size: 14px;
      line-height: 1.6;
      margin-bottom: 16px;
    }
    .modal-actions {
      display: flex;
      gap: 12px;
      margin-top: 20px;
    }
    .modal-actions .btn {
      flex: 1;
    }
    .last-update {
      text-align: center;
      color: #666;
      font-size: 11px;
      margin-top: 20px;
    }
    .footer {
      text-align: center;
      margin-top: 30px;
      padding: 20px;
      color: #666;
      font-size: 12px;
    }
    .footer a {
      color: #00d9ff;
      text-decoration: none;
    }
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
      z-index: 2000;
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
    .toast.success {
      background: rgba(0, 255, 136, 0.2);
      color: #00ff88;
      border: 1px solid rgba(0, 255, 136, 0.3);
    }
    .toast.error {
      background: rgba(255, 77, 77, 0.2);
      color: #ff4d4d;
      border: 1px solid rgba(255, 77, 77, 0.3);
    }
    .usage-guide {
      background: rgba(255,255,255,0.03);
      border-radius: 12px;
      padding: 20px;
      margin-top: 20px;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .usage-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #00d9ff;
    }
    .usage-section {
      margin-bottom: 16px;
    }
    .usage-section:last-child {
      margin-bottom: 0;
    }
    .usage-subtitle {
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 8px;
      color: #e0e0e0;
    }
    .usage-text {
      font-size: 13px;
      color: #888;
      line-height: 1.6;
    }
    .usage-text code {
      background: rgba(0, 217, 255, 0.15);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      color: #00d9ff;
    }
    .usage-text .forward-code {
      background: rgba(255, 136, 0, 0.15);
      color: #ff8800;
    }
    .client-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .client-card {
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      padding: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      cursor: pointer;
      transition: all 0.2s;
    }
    .client-card:hover {
      background: rgba(255,255,255,0.08);
      border-color: rgba(255, 136, 0, 0.3);
    }
    .client-card.selected {
      border-color: #ff8800;
      background: rgba(255, 136, 0, 0.1);
    }
    .client-id {
      font-weight: 600;
      color: #e0e0e0;
      margin-bottom: 4px;
    }
    .client-desc {
      font-size: 12px;
      color: #888;
    }
    .no-clients {
      text-align: center;
      padding: 20px;
      color: #666;
      font-size: 13px;
    }
    .hidden {
      display: none !important;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔌 feng3d-ctc 穿透客户端</h1>
      <div class="status running" id="status">运行中</div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-label">服务器</div>
        <div class="card-value" id="server">-</div>
      </div>
      <div class="card">
        <div class="card-label">连接状态</div>
        <div class="card-value" id="connection">-</div>
      </div>
      <div class="card">
        <div class="card-label">运行时长</div>
        <div class="card-value"><span id="uptime">-</span></div>
      </div>
      <div class="card">
        <div class="card-label">反向代理</div>
        <div class="card-value"><span id="proxyCount">0</span><span class="unit"> 个</span></div>
      </div>
      <div class="card">
        <div class="card-label">正向穿透</div>
        <div class="card-value"><span id="forwardCount">0</span><span class="unit"> 个</span></div>
      </div>
      <div class="card">
        <div class="card-label">重连次数</div>
        <div class="card-value"><span id="reconnectCount">0</span><span class="unit"> 次</span></div>
      </div>
    </div>

    <!-- 标签切换 -->
    <div class="tabs">
      <button class="tab active" id="tabReverse" onclick="switchTab('reverse')">反向代理模式</button>
      <button class="tab" id="tabForward" onclick="switchTab('forward')">正向穿透模式</button>
      <button class="tab" id="tabGuide" onclick="switchTab('guide')">使用说明</button>
    </div>

    <!-- 反向代理面板 -->
    <div class="proxies-section" id="reversePanel">
      <div class="section-header">
        <div class="section-title">反向代理映射</div>
        <button class="btn btn-primary btn-sm" id="showAddForm">+ 添加代理</button>
      </div>

      <div class="section-info">
        <strong>反向代理模式</strong> — 将公网端口映射到本地服务，适用于需要将本地服务暴露到公网的场景。
        访问 <code>http://服务器:端口</code> 即可访问本地服务。
      </div>

      <div class="add-form" id="addForm">
        <div class="form-row">
          <div class="form-group">
            <label>远程端口</label>
            <input type="number" id="newRemotePort" placeholder="8080" min="1" max="65535">
          </div>
          <div class="form-group">
            <label>本地端口</label>
            <input type="number" id="newLocalPort" placeholder="3000" min="1" max="65535">
          </div>
          <div class="form-group">
            <label>本地地址</label>
            <input type="text" id="newLocalHost" placeholder="localhost">
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="addProxy">添加</button>
            <button class="btn btn-secondary" id="cancelAdd">取消</button>
          </div>
        </div>
      </div>

      <div id="proxiesList"></div>
    </div>

    <!-- 正向穿透面板 -->
    <div class="proxies-section hidden" id="forwardPanel">
      <div class="section-header">
        <div class="section-title">正向穿透映射</div>
        <div>
          <button class="btn btn-primary btn-sm forward-btn" id="refreshClients">刷新客户端</button>
          <button class="btn btn-primary btn-sm forward-btn" id="showForwardForm">+ 添加穿透</button>
        </div>
      </div>

      <div class="section-info">
        <strong>正向穿透模式</strong> — 连接本地端口到远程客户端的端口，实现设备间的点对点连接。
        本地端口 <code>:本地端口</code> → 中继服务器 → 目标客户端 <code>:目标端口</code>
      </div>

      <!-- 客户端注册状态 -->
      <div id="registerSection" style="margin-bottom: 16px;">
        <button class="btn btn-primary forward-btn btn-sm" id="registerBtn">注册到服务器</button>
        <span id="registerStatus" style="margin-left: 12px; color: #888; font-size: 13px;"></span>
      </div>

      <!-- 在线客户端列表 -->
      <div id="clientsSection" class="hidden" style="margin-bottom: 16px;">
        <div class="section-subtitle" style="font-size: 13px; color: #888; margin-bottom: 8px;">在线客户端列表</div>
        <div id="clientsList" class="client-list"></div>
      </div>

      <div class="add-form forward-form" id="forwardForm">
        <div class="form-row forward-row">
          <div class="form-group">
            <label>本地端口</label>
            <input type="number" id="forwardLocalPort" placeholder="8080" min="1" max="65535">
          </div>
          <div class="form-group">
            <label>目标客户端</label>
            <select id="targetClientId">
              <option value="">请先刷新客户端列表</option>
            </select>
          </div>
          <div class="form-group">
            <label>目标端口</label>
            <input type="number" id="forwardTargetPort" placeholder="3000" min="1" max="65535">
          </div>
          <div class="form-actions">
            <button class="btn btn-primary forward-btn" id="addForward">添加</button>
            <button class="btn btn-secondary" id="cancelForward">取消</button>
          </div>
        </div>
      </div>

      <div id="forwardList"></div>
    </div>

    <!-- 使用说明面板 -->
    <div class="usage-guide hidden" id="guidePanel">
      <div class="usage-title">📖 使用说明</div>

      <div class="usage-section">
        <div class="usage-subtitle">反向代理模式</div>
        <div class="usage-text">
          <strong>用途：</strong>将本地服务暴露到公网，适用于开发调试、远程访问本地服务等场景。<br><br>
          <strong>工作原理：</strong><br>
          1. 客户端连接到中继服务器并注册代理映射<br>
          2. 服务器在指定公网端口监听连接<br>
          3. 外部用户访问 <code>http://服务器IP:远程端口</code><br>
          4. 服务器将连接通过数据通道转发到客户端的本地端口<br><br>
          <strong>使用场景：</strong>本地开发、微信开发、远程桌面、NAS 访问等
        </div>
      </div>

      <div class="usage-section">
        <div class="usage-subtitle">正向穿透模式</div>
        <div class="usage-text">
          <strong>用途：</strong>实现多个内网设备之间的点对点连接，无需公网暴露。<br><br>
          <strong>工作原理：</strong><br>
          1. 多个客户端都连接到同一个中继服务器<br>
          2. 客户端 A 注册为可被发现，客户端 B 可以查看在线客户端列表<br>
          3. 客户端 B 创建本地端口 → 目标客户端端口的映射<br>
          4. 用户连接本地端口，数据通过中继服务器转发到目标客户端的指定端口<br><br>
          <strong>使用场景：</strong>分支机构互联、SSH 跳板机、远程办公室设备访问、点对点文件传输
        </div>
      </div>

      <div class="usage-section">
        <div class="usage-subtitle">架构对比</div>
        <div class="usage-text">
          <strong>反向代理（传统模式）：</strong><br>
          公网用户 → 中继服务器:端口 → 内网客户端:本地端口<br><br>
          <strong>典型工具：</strong>ngrok、frp<br><br>

          <strong>正向穿透（本系统特色）：</strong><br>
          用户 → 客户端A:本地端口 → 中继服务器 → 客户端B:目标端口<br>
          <strong>优势：</strong>无需公网暴露、设备间直连、支持多客户端组网
        </div>
      </div>

      <div class="usage-section">
        <div class="usage-subtitle">快速开始</div>
        <div class="usage-text">
          <strong>1. 启动服务器：</strong><code>npx @feng3d/cts start</code><br>
          <strong>2. 启动客户端 A（反向代理）：</strong><code>npx @feng3d/ctc start -p "8080:3000"</code><br>
          <strong>3. 启动客户端 B（正向穿透）：</strong><code>npx @feng3d/ctc start</code>，然后在管理页面注册并添加穿透映射<br>
          <strong>4. 访问服务：</strong>浏览器打开 <code>http://服务器IP:8080</code> 即可访问客户端 A 的本地服务
        </div>
      </div>
    </div>

    <div class="last-update">最后更新: <span id="lastUpdate">-</span></div>

    <div class="footer">
      <a href="https://github.com/feng3d/chuantou" target="_blank">feng3d-ctc</a>
      — 内网穿透客户端
    </div>
  </div>

  <div class="modal" id="deleteModal">
    <div class="modal-content">
      <div class="modal-title">确认删除代理</div>
      <div class="modal-body">确定要删除此代理映射吗？</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cancelDelete">取消</button>
        <button class="btn btn-danger" id="confirmDelete">删除</button>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    let deletePort = null;
    let deleteLocalPort = null; // 用于正向穿透
    let currentTab = 'reverse';
    let selectedClientId = ''; // 正向穿透选中的目标客户端

    function formatUptime(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return \`\${days}天 \${hours % 24}小时\`;
      if (hours > 0) return \`\${hours}小时 \${minutes % 60}分钟\`;
      if (minutes > 0) return \`\${minutes}分钟 \${seconds % 60}秒\`;
      return \`\${seconds}秒\`;
    }

    function showToast(message, type = 'success') {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = \`toast \${type} show\`;
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    function switchTab(tab) {
      currentTab = tab;

      // 更新标签状态
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      if (tab === 'reverse') {
        document.getElementById('tabReverse').classList.add('active');
      } else if (tab === 'forward') {
        document.getElementById('tabForward').classList.add('active', 'forward-tab');
      } else {
        document.getElementById('tabGuide').classList.add('active');
      }

      // 切换面板
      document.getElementById('reversePanel').classList.toggle('hidden', tab !== 'reverse');
      document.getElementById('forwardPanel').classList.toggle('hidden', tab !== 'forward');
      document.getElementById('guidePanel').classList.toggle('hidden', tab !== 'guide');
    }

    async function updateStatus() {
      try {
        const res = await fetch('/_ctc/status');
        const data = await res.json();

        const statusEl = document.getElementById('status');
        if (data.running) {
          statusEl.textContent = data.authenticated ? '已连接' : (data.connected ? '认证中...' : '连接中...');
          statusEl.className = 'status running';
        } else {
          statusEl.textContent = '已停止';
          statusEl.className = 'status stopped';
        }

        document.getElementById('server').textContent = data.serverUrl.replace('ws://', '').replace('wss://', '');
        document.getElementById('connection').textContent = data.authenticated ? '已认证' : (data.connected ? '已连接' : '未连接');
        document.getElementById('uptime').textContent = formatUptime(data.uptime);
        document.getElementById('proxyCount').textContent = data.proxies.length;
        document.getElementById('reconnectCount').textContent = data.reconnectAttempts;
        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('zh-CN');

        // 更新正向穿透注册状态
        if (data.isRegistered !== undefined) {
          updateRegisterStatus(data.isRegistered);
        }
        if (data.clientId) {
          document.getElementById('registerStatus').textContent = \`已注册 (ID: \${data.clientId})\`;
        }

        // 更新反向代理列表
        const listEl = document.getElementById('proxiesList');
        if (data.proxies.length === 0) {
          listEl.innerHTML = '<div class="empty-state">暂无反向代理映射，点击上方按钮添加</div>';
        } else {
          listEl.innerHTML = data.proxies.map(p => {
            return \`
              <div class="proxy-item">
                <div class="proxy-info">
                  <span class="proxy-index">#\${p.index || '-'}</span>
                  <span class="proxy-protocol">ALL</span>
                  <span class="proxy-remote">:\${p.remotePort}</span>
                  <span class="proxy-arrow">→</span>
                  <span class="proxy-local">\${p.localHost || 'localhost'}:\${p.localPort}</span>
                </div>
                <button class="btn btn-danger" onclick="showDeleteModal(\${p.remotePort}, 'reverse')">删除</button>
              </div>
            \`;
          }).join('');
        }

        // 更新正向穿透列表
        if (data.forwardProxies) {
          updateForwardList(data.forwardProxies);
        }
      } catch (e) {
        console.error('获取状态失败:', e);
      }
    }

    function updateRegisterStatus(isRegistered) {
      const statusEl = document.getElementById('registerStatus');
      if (isRegistered) {
        statusEl.textContent = '已注册';
        statusEl.style.color = '#00ff88';
      } else {
        statusEl.textContent = '未注册';
        statusEl.style.color = '#888';
      }
    }

    function updateForwardList(proxies) {
      document.getElementById('forwardCount').textContent = proxies.length;

      const listEl = document.getElementById('forwardList');
      if (proxies.length === 0) {
        listEl.innerHTML = '<div class="empty-state">暂无正向穿透映射，点击上方按钮添加</div>';
      } else {
        listEl.innerHTML = proxies.map(p => {
          return \`
            <div class="proxy-item forward-item">
              <div class="proxy-info">
                <span class="proxy-index">→</span>
                <span class="proxy-protocol">P2P</span>
                <span class="proxy-remote">:\${p.localPort}</span>
                <span class="proxy-arrow">→</span>
                <span class="proxy-local">\${p.targetClientId}:\${p.targetPort}</span>
              </div>
              <button class="btn btn-danger" onclick="showDeleteModal(\${p.localPort}, 'forward')">删除</button>
            </div>
          \`;
        }).join('');
      }
    }

    function updateClientsList(clients) {
      const sectionEl = document.getElementById('clientsSection');
      const listEl = document.getElementById('clientsList');
      const selectEl = document.getElementById('targetClientId');

      if (!clients || clients.length === 0) {
        if (sectionEl) sectionEl.classList.add('hidden');
        selectEl.innerHTML = '<option value="">无在线客户端</option>';
        return;
      }

      sectionEl.classList.remove('hidden');

      // 更新客户端卡片列表
      listEl.innerHTML = clients.map(c => {
        const isSelected = c.id === selectedClientId;
        return \`
          <div class="client-card \${isSelected ? 'selected' : ''}" onclick="selectClient('\${c.id}')">
            <div class="client-id">\${c.id}</div>
            <div class="client-desc">\${c.description || '无描述'}</div>
          </div>
        \`;
      }).join('');

      // 更新下拉选择框
      const currentValue = selectEl.value;
      selectEl.innerHTML = '<option value="">选择目标客户端</option>' + clients.map(c => {
        return \`<option value="\${c.id}">\${c.id} (\${c.description || '无描述'})</option>\`;
      }).join('');
      if (currentValue) {
        selectEl.value = currentValue;
      }
    }

    function selectClient(clientId) {
      selectedClientId = clientId;
      document.querySelectorAll('.client-card').forEach(card => card.classList.remove('selected'));
      event.target.classList.add('selected');
    }

    async function loadClientsList() {
      try {
        const res = await fetch('/_ctc/forward/clients');
        if (res.ok) {
          const data = await res.json();
          updateClientsList(data.clients || []);
        } else {
          const data = await res.json();
          showToast(\`获取客户端列表失败: \${data.error}\`, 'error');
        }
      } catch (e) {
        showToast('获取客户端列表失败: 网络错误', 'error');
      }
    }

    async function registerClient() {
      try {
        const res = await fetch('/_ctc/forward/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: 'feng3d-ctc 客户端' })
        });

        const data = await res.json();
        if (data.success) {
          showToast('已注册到服务器');
          document.getElementById('registerBtn').textContent = '已注册';
          document.getElementById('registerBtn').disabled = true;
          loadClientsList();
        } else {
          showToast(\`注册失败: \${data.error}\`, 'error');
        }
      } catch (e) {
        showToast('注册失败: 网络错误', 'error');
      }
    }

    // ========== 反向代理功能 ==========

    function showDeleteModal(port, type = 'reverse') {
      if (type === 'reverse') {
        deletePort = port;
        deleteLocalPort = null;
      } else {
        deleteLocalPort = port;
        deletePort = null;
      }
      document.getElementById('deleteModal').classList.add('show');
    }

    document.getElementById('cancelDelete').addEventListener('click', () => {
      document.getElementById('deleteModal').classList.remove('show');
      deletePort = null;
      deleteLocalPort = null;
    });

    document.getElementById('confirmDelete').addEventListener('click', async () => {
      // 关闭模态框
      document.getElementById('deleteModal').classList.remove('show');

      if (deletePort) {
        try {
          const res = await fetch(\`/_ctc/proxies/\${deletePort}\`, { method: 'DELETE' });
          if (res.ok) {
            showToast('反向代理已删除');
            updateStatus();
          } else {
            const data = await res.json();
            showToast(\`删除失败: \${data.error}\`, 'error');
          }
        } catch (e) {
          showToast('删除失败: 网络错误', 'error');
        }
      }

      if (deleteLocalPort) {
        try {
          const res = await fetch('/_ctc/forward/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localPort: deleteLocalPort })
          });
          const data = await res.json();
          if (data.success) {
            showToast('正向穿透已删除');
            // 更新正向穿透列表
            loadForwardList();
          } else {
            showToast(\`删除失败: \${data.error}\`, 'error');
          }
        } catch (e) {
          showToast('删除失败: 网络错误', 'error');
        }
      }

      deletePort = null;
      deleteLocalPort = null;
    });

    document.getElementById('showAddForm').addEventListener('click', () => {
      document.getElementById('addForm').classList.add('show');
    });

    document.getElementById('cancelAdd').addEventListener('click', () => {
      document.getElementById('addForm').classList.remove('show');
    });

    document.getElementById('addProxy').addEventListener('click', async () => {
      const remotePort = parseInt(document.getElementById('newRemotePort').value);
      const localPort = parseInt(document.getElementById('newLocalPort').value);
      const localHost = document.getElementById('newLocalHost').value || 'localhost';

      if (!remotePort || !localPort) {
        showToast('请填写完整信息', 'error');
        return;
      }

      try {
        const res = await fetch('/_ctc/proxies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ remotePort, localPort, localHost })
        });

        if (res.ok) {
          showToast('反向代理已添加');
          document.getElementById('addForm').classList.remove('show');
          document.getElementById('newRemotePort').value = '';
          document.getElementById('newLocalPort').value = '';
          document.getElementById('newLocalHost').value = 'localhost';
          updateStatus();
        } else {
          const data = await res.json();
          showToast(\`添加失败: \${data.error}\`, 'error');
        }
      } catch (e) {
        showToast('添加失败: 网络错误', 'error');
      }
    });

    // ========== 正向穿透功能 ==========

    async function loadForwardList() {
      try {
        const res = await fetch('/_ctc/forward/list');
        if (res.ok) {
          const data = await res.json();
          updateForwardList(data.proxies || []);
        }
      } catch (e) {
        console.error('获取正向穿透列表失败:', e);
      }
    }

    document.getElementById('refreshClients').addEventListener('click', () => {
      loadClientsList();
    });

    document.getElementById('showForwardForm').addEventListener('click', () => {
      document.getElementById('forwardForm').classList.add('show');
      if (!document.getElementById('clientsList').textContent.trim()) {
        loadClientsList();
      }
    });

    document.getElementById('cancelForward').addEventListener('click', () => {
      document.getElementById('forwardForm').classList.remove('show');
      selectedClientId = '';
      document.querySelectorAll('.client-card').forEach(card => card.classList.remove('selected'));
    });

    document.getElementById('addForward').addEventListener('click', async () => {
      const localPort = parseInt(document.getElementById('forwardLocalPort').value);
      const targetClientId = document.getElementById('targetClientId').value;
      const targetPort = parseInt(document.getElementById('forwardTargetPort').value);

      if (!localPort || !targetClientId || !targetPort) {
        showToast('请填写完整信息', 'error');
        return;
      }

      try {
        const res = await fetch('/_ctc/forward/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ localPort, targetClientId, targetPort })
        });

        const data = await res.json();
        if (data.success) {
          showToast('正向穿透已添加');
          document.getElementById('forwardForm').classList.remove('show');
          document.getElementById('forwardLocalPort').value = '';
          document.getElementById('forwardTargetPort').value = '';
          document.getElementById('targetClientId').value = '';
          selectedClientId = '';
          loadForwardList();
        } else {
          showToast(\`添加失败: \${data.error}\`, 'error');
        }
      } catch (e) {
        showToast('添加失败: 网络错误', 'error');
      }
    });

    document.getElementById('registerBtn').addEventListener('click', registerClient);

    // 初始化
    updateStatus();
    setInterval(updateStatus, 3000);

    // 如果在正向穿透标签页，自动加载客户端列表
    if (currentTab === 'forward') {
      loadClientsList();
      loadForwardList();
    }
  </script>
</body>
</html>
`;

  /**
   * 创建管理服务器实例
   *
   * @param config - 服务器配置
   * @param getStatus - 获取状态的回调函数
   * @param addProxy - 添加反向代理的回调函数
   * @param removeProxy - 删除反向代理的回调函数
   * @param addForwardProxy - 添加正向穿透的回调函数
   * @param removeForwardProxy - 删除正向穿透的回调函数
   * @param registerClient - 注册客户端的回调函数
   * @param getClientList - 获取客户端列表的回调函数
   */
  constructor(
    config: AdminServerConfig,
    getStatus: () => ClientStatus,
    addProxy: (proxy: ProxyConfig) => Promise<void>,
    removeProxy: (remotePort: number) => Promise<void>,
    addForwardProxy?: (entry: ForwardProxyEntry) => Promise<void>,
    removeForwardProxy?: (localPort: number) => Promise<void>,
    registerClient?: (description?: string) => Promise<void>,
    getClientList?: () => Promise<any>,
    sendMessage?: (message: any) => Promise<any>
  ) {
    this.port = config.port;
    this.host = config.host;
    this.startedAt = Date.now();
    this.getStatusCallback = getStatus;
    this.addProxyCallback = addProxy;
    this.removeProxyCallback = removeProxy;
    this.addForwardProxyCallback = addForwardProxy;
    this.removeForwardProxyCallback = removeForwardProxy;
    this.registerClientCallback = registerClient;
    this.getClientListCallback = getClientList;
    this.sendMessageCallback = sendMessage;

    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  /**
   * 设置发送消息的回调
   */
  setSendMessageCallback(callback: (message: any) => Promise<any>): void {
    this.sendMessageCallback = callback;
  }

  /**
   * 启动服务器
   *
   * @returns 启动完成的 Promise
   */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        console.log(`管理页面已启动: http://${this.host}:${this.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('管理服务器错误:', error);
        reject(error);
      });
    });
  }

  /**
   * 处理 HTTP 请求
   *
   * 提供以下端点：
   * 反向代理：
   *   - `GET /` - 管理页面
   *   - `GET /_ctc/status` - 获取状态
   *   - `POST /_ctc/proxies` - 添加反向代理
   *   - `DELETE /_ctc/proxies/:port` - 删除反向代理
   * 正向穿透：
   *   - `GET /_ctc/forward/list` - 获取正向穿透列表
   *   - `POST /_ctc/forward/add` - 添加正向穿透
   *   - `POST /_ctc/forward/remove` - 删除正向穿透
   *   - `GET /_ctc/forward/clients` - 获取客户端列表
   *   - `POST /_ctc/forward/register` - 注册到服务器
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // 静态文件服务
    if (url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(AdminServer.STATUS_HTML);
      return;
    }

    // 处理静态文件请求
    if (req.method === 'GET' && url.startsWith('/_ctc/static/')) {
      const fileName = url.slice('/_ctc/static/'.length) as string;
      const filePath = join(AdminServer.STATIC_DIR, fileName);

      try {
        const data = await readFile(filePath, 'utf-8');
        if (!data) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('File not found');
          return;
        }
        const ext = fileName.split('.').pop() || 'html';
        const contentType = ext === 'css' ? 'text/css; charset=utf-8' :
                         ext === 'js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';

        res.writeHead(200, {
          'Content-Type': contentType as string,
          'Cache-Control': 'public, max-age=3600'
        });
        res.end(data as string);
        return;
      } catch (err) {
        console.error('静态文件读取错误:', err);
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('File not found');
        return;
      }
    }

    // 状态 API
    if (url === '/_ctc/status' && req.method === 'GET') {
      const status = this.getStatusCallback();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // ==================== 反向代理 API ====================

    // 添加反向代理 API
    if (url === '/_ctc/proxies' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const proxy = JSON.parse(body) as ProxyConfig;
          await this.addProxyCallback(proxy);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // 删除反向代理 API
    if (url.startsWith('/_ctc/proxies/') && req.method === 'DELETE') {
      const port = parseInt(url.split('/').pop()!, 10);
      if (isNaN(port)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无效的端口号' }));
        return;
      }

      this.removeProxyCallback(port)
        .then(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        });
      return;
    }

    // ==================== 正向穿透 API ====================

    // forward list - 列出正向穿透代理
    if (url === '/_ctc/forward/list' && req.method === 'GET') {
      const proxies = Array.from(this.forwardProxies.entries()).map(([key, value]) => ({
        localPort: value.localPort,
        targetClientId: value.targetClientId,
        targetPort: value.targetPort,
        enabled: true,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ proxies }));
      return;
    }

    // forward add - 添加正向穿透代理
    if (url === '/_ctc/forward/add' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body) as { localPort: number; targetClientId: string; targetPort: number };
          const key = `${data.localPort}`;

          if (this.addForwardProxyCallback) {
            await this.addForwardProxyCallback({
              ...data,
              enabled: true,
            });
          }

          this.forwardProxies.set(key, {
            localPort: data.localPort,
            targetClientId: data.targetClientId,
            targetPort: data.targetPort,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // forward remove - 移除正向穿透代理
    if (url === '/_ctc/forward/remove' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body) as { localPort: number };
          const key = `${data.localPort}`;
          const deleted = this.forwardProxies.delete(key);

          if (this.removeForwardProxyCallback) {
            await this.removeForwardProxyCallback(data.localPort);
          }

          if (deleted) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '代理不存在' }));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // forward clients - 获取客户端列表
    if (url === '/_ctc/forward/clients' && req.method === 'GET') {
      if (!this.getClientListCallback) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '服务未就绪' }));
        return;
      }

      try {
        const result = await this.getClientListCallback();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errorMessage }));
      }
      return;
    }

    // forward register - 注册到服务器
    if (url === '/_ctc/forward/register' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body) as { description?: string };
          if (!this.registerClientCallback) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '服务未就绪' }));
            return;
          }

          const result = await this.registerClientCallback(data.description);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: errorMessage }));
        }
      });
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.server.close(() => {
        console.log('管理服务器已停止');
        resolve();
      });
    });
  }
}
