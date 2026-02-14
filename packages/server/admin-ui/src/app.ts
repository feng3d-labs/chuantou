/**
 * @module admin-ui
 * @description 服务端管理页面前端交互逻辑
 */

declare var document: Document;

let disconnectClientId: string | null = null;
let currentTab: string = 'sessions';

/**
 * 格式化运行时长
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天 ${hours % 24}小时`;
  if (hours > 0) return `${hours}小时 ${minutes % 60}分钟`;
  if (minutes > 0) return `${minutes}分钟 ${seconds % 60}秒`;
  return `${seconds}秒`;
}

/**
 * 显示 Toast 消息
 */
function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const toast = document.getElementById('toast') as HTMLDivElement;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

/**
 * 切换标签页
 */
function switchTab(tab: string): void {
  currentTab = tab;

  // 更新标签状态
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (tab === 'sessions') {
    document.getElementById('tabSessions')?.classList.add('active');
  } else if (tab === 'ports') {
    document.getElementById('tabPorts')?.classList.add('active');
  } else {
    document.getElementById('tabGuide')?.classList.add('active');
  }

  // 切换面板
  document.getElementById('sessionsPanel')?.classList.toggle('hidden', tab !== 'sessions');
  document.getElementById('portsPanel')?.classList.toggle('hidden', tab !== 'ports');
  document.getElementById('guidePanel')?.classList.toggle('hidden', tab !== 'guide');
}

/**
 * 更新服务器状态
 */
async function updateStatus(): Promise<void> {
  try {
    const res = await fetch('/_chuantou/status');
    const data = await res.json();

    // 更新状态指示器
    const statusEl = document.getElementById('status');
    if (statusEl) {
      if (data.running) {
        statusEl.textContent = '运行中';
        statusEl.className = 'status running';
      } else {
        statusEl.textContent = '已停止';
        statusEl.className = 'status stopped';
      }
    }

    // 更新卡片数据
    const hostEl = document.getElementById('host');
    if (hostEl) {
      hostEl.textContent = `${data.host}:${data.controlPort}`;
    }

    const uptimeEl = document.getElementById('uptime');
    if (uptimeEl) {
      uptimeEl.textContent = formatUptime(data.uptime);
    }

    const clientsEl = document.getElementById('clients');
    if (clientsEl) {
      clientsEl.textContent = String(data.authenticatedClients);
    }

    const portsEl = document.getElementById('ports');
    if (portsEl) {
      portsEl.textContent = String(data.totalPorts);
    }

    const connectionsEl = document.getElementById('connections');
    if (connectionsEl) {
      connectionsEl.textContent = String(data.activeConnections);
    }

    const tlsEl = document.getElementById('tls');
    if (tlsEl) {
      tlsEl.textContent = data.tls ? '已启用' : '已禁用';
    }

    const lastUpdateEl = document.getElementById('lastUpdate');
    if (lastUpdateEl) {
      lastUpdateEl.textContent = new Date().toLocaleTimeString('zh-CN');
    }
  } catch (e) {
    console.error('获取状态失败:', e);
  }
}

/**
 * 更新客户端会话列表
 */
async function updateSessions(): Promise<void> {
  try {
    const res = await fetch('/_chuantou/sessions');
    const sessions = await res.json();

    const listEl = document.getElementById('sessionsList');
    if (!listEl) return;

    if (sessions.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无客户端连接</div>';
      return;
    }

    listEl.innerHTML = sessions.map((s: {
      clientId: string;
      connectedAt: number;
      registeredPorts?: number[];
    }) => {
      const shortId = s.clientId.slice(0, 8);
      const portCount = s.registeredPorts?.length || 0;
      const connectTime = new Date(s.connectedAt).toLocaleTimeString('zh-CN');

      return `
        <div class="session-item">
          <div class="session-info">
            <span class="session-id">${shortId}...</span>
            <span class="session-time">连接于 ${connectTime}</span>
            ${portCount > 0 ? `<span class="session-ports">${portCount} 个端口</span>` : ''}
          </div>
          <button class="btn btn-danger btn-sm" onclick="showDisconnectModal('${s.clientId}')">断开</button>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('获取会话列表失败:', e);
  }
}

/**
 * 更新端口映射列表
 */
async function updatePorts(): Promise<void> {
  try {
    const res = await fetch('/_chuantou/ports');
    const data = await res.json();

    const listEl = document.getElementById('portsList');
    if (!listEl) return;

    if (!data.ports || data.ports.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无端口映射</div>';
      return;
    }

    listEl.innerHTML = data.ports.map((p: {
      port: number;
      clientId: string;
      connections: number;
      description?: string;
    }) => {
      const shortId = p.clientId.slice(0, 8);

      return `
        <div class="port-item">
          <div class="port-info">
            <span class="port-number">:${p.port}</span>
            <span class="port-client">${shortId}...</span>
            <span class="port-connections">${p.connections} 连接</span>
          </div>
          ${p.description ? `<div class="port-description">${p.description}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('获取端口列表失败:', e);
  }
}

/**
 * 显示断开连接确认模态框
 */
function showDisconnectModal(clientId: string): void {
  disconnectClientId = clientId;
  const shortId = clientId.slice(0, 8);
  const modalBody = document.getElementById('modalBody');
  if (modalBody) {
    modalBody.textContent = `确定要断开客户端 ${shortId}... 的连接吗？`;
  }
  document.getElementById('disconnectModal')?.classList.add('show');
}

/**
 * 确认断开连接
 */
async function confirmDisconnect(): Promise<void> {
  if (!disconnectClientId) return;

  const clientId = disconnectClientId;
  document.getElementById('disconnectModal')?.classList.remove('show');

  try {
    const res = await fetch(`/_chuantou/sessions/${encodeURIComponent(clientId)}/disconnect`, {
      method: 'POST'
    });
    const data = await res.json();

    if (data.success) {
      showToast('客户端已断开连接');
      updateSessions();
      updatePorts();
    } else {
      showToast(`断开失败: ${data.error || '未知错误'}`, 'error');
    }
  } catch (e) {
    showToast('断开失败: 网络错误', 'error');
  }

  disconnectClientId = null;
}

/**
 * 清理孤立端口
 */
async function cleanupOrphanPorts(): Promise<void> {
  try {
    const res = await fetch('/_chuantou/cleanup', {
      method: 'POST'
    });
    const data = await res.json() as { success: boolean; found: number; cleaned: number; ports: number[] };

    if (data.success) {
      if (data.found === 0) {
        showToast('没有发现孤立端口');
      } else {
        showToast(`已清理 ${data.cleaned} 个孤立端口: ${data.ports.join(', ')}`);
        updatePorts();
      }
    } else {
      showToast('清理失败', 'error');
    }
  } catch (e) {
    showToast('清理失败: 网络错误', 'error');
  }
}

/**
 * 初始化
 */
function init(): void {
  // 初始化模态框
  const cancelBtn = document.getElementById('cancelDisconnect');
  const confirmBtn = document.getElementById('confirmDisconnect');

  cancelBtn?.addEventListener('click', () => {
    document.getElementById('disconnectModal')?.classList.remove('show');
    disconnectClientId = null;
  });

  confirmBtn?.addEventListener('click', confirmDisconnect);

  // 初始化状态更新
  updateStatus();
  setInterval(updateStatus, 3000);

  // 更新会话列表
  updateSessions();
  setInterval(updateSessions, 5000);

  // 更新端口列表
  updatePorts();
  setInterval(updatePorts, 5000);
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
