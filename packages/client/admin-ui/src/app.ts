/**
 * @module admin-ui
 * @description 客户端管理页面前端交互逻辑
 */

declare var document: Document;
declare var event: Event | undefined;

let deletePort: number | null = null;
let deleteLocalPort: number | null = null; // 用于正向穿透
let currentTab: any = 'reverse';
let selectedClientId = ''; // 正向穿透选中的目标客户端

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

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const toast = document.getElementById('toast') as HTMLDivElement;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function switchTab(tab: any): void {
  currentTab = tab;

  // 更新标签状态
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (tab === 'reverse') {
    document.getElementById('tabReverse')?.classList.add('active');
  } else if (tab === 'forward') {
    document.getElementById('tabForward')?.classList.add('active', 'forward-tab');
  } else {
    document.getElementById('tabGuide')?.classList.add('active');
  }

  // 切换面板
  document.getElementById('reversePanel')?.classList.toggle('hidden', tab !== 'reverse');
  document.getElementById('forwardPanel')?.classList.toggle('hidden', tab !== 'forward');
  document.getElementById('guidePanel')?.classList.toggle('hidden', tab !== 'guide');
}

async function updateStatus(): Promise<void> {
  try {
    const res = await fetch('/_ctc/status');
    const data = await res.json();

    const statusEl = document.getElementById('status');
    if (statusEl) {
      if (data.running) {
        statusEl.textContent = data.authenticated ? '已连接' : (data.connected ? '认证中...' : '连接中...');
        statusEl.className = 'status running';
      } else {
        statusEl.textContent = '已停止';
        statusEl.className = 'status stopped';
      }
    }

    const serverEl = document.getElementById('server');
    if (serverEl) {
      serverEl.textContent = data.serverUrl.replace('ws://', '').replace('wss://', '');
    }

    const connectionEl = document.getElementById('connection');
    if (connectionEl) {
      connectionEl.textContent = data.authenticated ? '已认证' : (data.connected ? '已连接' : '未连接');
    }

    const uptimeEl = document.getElementById('uptime');
    if (uptimeEl) {
      uptimeEl.textContent = formatUptime(data.uptime);
    }

    const proxyCountEl = document.getElementById('proxyCount');
    if (proxyCountEl) {
      proxyCountEl.textContent = String(data.proxies.length);
    }

    const reconnectCountEl = document.getElementById('reconnectCount');
    if (reconnectCountEl) {
      reconnectCountEl.textContent = String(data.reconnectAttempts);
    }

    const lastUpdateEl = document.getElementById('lastUpdate');
    if (lastUpdateEl) {
      lastUpdateEl.textContent = new Date().toLocaleTimeString('zh-CN');
    }

    // 更新正向穿透注册状态
    if (data.isRegistered !== undefined) {
      updateRegisterStatus(data.isRegistered);
    }

    const registerStatusEl = document.getElementById('registerStatus');
    if (registerStatusEl && data.clientId) {
      registerStatusEl.textContent = `已注册 (ID: ${data.clientId})`;
    }

    // 更新反向代理列表
    const listEl = document.getElementById('proxiesList');
    if (listEl) {
      if (data.proxies.length === 0) {
        listEl.innerHTML = '<div class="empty-state">暂无反向代理映射，点击上方按钮添加</div>';
      } else {
        listEl.innerHTML = data.proxies.map((p: any) => {
          return `
              <div class="proxy-item">
                <div class="proxy-info">
                  <span class="proxy-index">#${p.index || '-'}</span>
                  <span class="proxy-protocol">ALL</span>
                  <span class="proxy-remote">:${p.remotePort}</span>
                  <span class="proxy-arrow">→</span>
                  <span class="proxy-local">${p.localHost || 'localhost'}:${p.localPort}</span>
                </div>
                <button class="btn btn-danger" onclick="showDeleteModal(${p.remotePort}, 'reverse')">删除</button>
              </div>
            `;
        }).join('');
      }
    }

    // 更新正向穿透列表
    if (data.forwardProxies) {
      updateForwardList(data.forwardProxies);
    }
  } catch (e) {
    console.error('获取状态失败:', e);
  }
}

function updateRegisterStatus(isRegistered: boolean): void {
  const statusEl = document.getElementById('registerStatus');
  if (statusEl) {
    if (isRegistered) {
      statusEl.textContent = '已注册';
      statusEl.style.color = '#00ff88';
    } else {
      statusEl.textContent = '未注册';
      statusEl.style.color = '#888';
    }
  }
}

function updateForwardList(proxies: Array<{ localPort: number; targetClientId: string; targetPort: number }>): void {
  const forwardCountEl = document.getElementById('forwardCount');
  if (forwardCountEl) {
    forwardCountEl.textContent = String(proxies.length);
  }

  const listEl = document.getElementById('forwardList');
  if (listEl) {
    if (proxies.length === 0) {
      listEl.innerHTML = '<div class="empty-state">暂无正向穿透映射，点击上方按钮添加</div>';
    } else {
      listEl.innerHTML = proxies.map(p => {
        return `
            <div class="proxy-item forward-item">
              <div class="proxy-info">
                <span class="proxy-index">→</span>
                <span class="proxy-protocol">P2P</span>
                <span class="proxy-remote">:${p.localPort}</span>
                <span class="proxy-arrow">→</span>
                <span class="proxy-local">${p.targetClientId}:${p.targetPort}</span>
              </div>
              <button class="btn btn-danger" onclick="showDeleteModal(${p.localPort}, 'forward')">删除</button>
            </div>
          `;
      }).join('');
    }
  }
}

interface Client {
  id: string;
  description?: string;
}

function updateClientsList(clients: Client[]): void {
  const sectionEl = document.getElementById('clientsSection');
  const listEl = document.getElementById('clientsList');
  const selectEl = document.getElementById('targetClientId') as HTMLSelectElement;

  if (!clients || clients.length === 0) {
    if (sectionEl) sectionEl.classList.add('hidden');
    if (selectEl) {
      selectEl.innerHTML = '<option value="">无在线客户端</option>';
    }
    return;
  }

  if (sectionEl) sectionEl.classList.remove('hidden');

  // 更新客户端卡片列表
  if (listEl) {
    listEl.innerHTML = clients.map(c => {
      const isSelected = c.id === selectedClientId;
      return `
          <div class="client-card ${isSelected ? 'selected' : ''}" onclick="selectClient('${c.id}')">
            <div class="client-id">${c.id}</div>
            <div class="client-desc">${c.description || '无描述'}</div>
          </div>
        `;
    }).join('');
  }

  // 更新下拉选择框
  if (selectEl) {
    const currentValue = selectEl.value;
    selectEl.innerHTML = '<option value="">选择目标客户端</option>' + clients.map(c => {
      return `<option value="${c.id}">${c.id} (${c.description || '无描述'})</option>`;
    }).join('');
    if (currentValue) {
      selectEl.value = currentValue;
    }
  }
}

function selectClient(clientId: string): void {
  selectedClientId = clientId;
  document.querySelectorAll('.client-card').forEach(card => card.classList.remove('selected'));
  if (event && event.target) {
    const target = (event.target as HTMLElement).closest('.client-card');
    if (target) {
      target.classList.add('selected');
    }
  }
}

async function loadClientsList(): Promise<void> {
  try {
    const res = await fetch('/_ctc/forward/clients');
    if (res.ok) {
      const data = await res.json();
      updateClientsList(data.clients || []);
    } else {
      const data = await res.json();
      showToast(`获取客户端列表失败: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast('获取客户端列表失败: 网络错误', 'error');
  }
}

async function registerClient(): Promise<void> {
  try {
    const res = await fetch('/_ctc/forward/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'feng3d-ctc 客户端' })
    });

    const data = await res.json();
    if (data.success) {
      showToast('已注册到服务器');
      const registerBtn = document.getElementById('registerBtn');
      if (registerBtn) {
        registerBtn.textContent = '已注册';
        (registerBtn as HTMLButtonElement).disabled = true;
      }
      loadClientsList();
    } else {
      showToast(`注册失败: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast('注册失败: 网络错误', 'error');
  }
}

function showDeleteModal(port: number, type: 'reverse' | 'forward' = 'reverse'): void {
  if (type === 'reverse') {
    deletePort = port;
    deleteLocalPort = null;
  } else {
    deleteLocalPort = port;
    deletePort = null;
  }
  document.getElementById('deleteModal')?.classList.add('show');
}

/**
 * 手动触发重连到服务器
 */
async function manualReconnect(): Promise<void> {
  const reconnectBtn = document.getElementById('reconnectBtn') as HTMLButtonElement;
  if (!reconnectBtn) return;

  // 禁用按钮并显示加载状态
  reconnectBtn.disabled = true;
  const originalText = reconnectBtn.textContent;
  reconnectBtn.textContent = '连接中...';

  try {
    const res = await fetch('/_ctc/reconnect', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      showToast(data.message || '正在重连...', 'success');
      // 等待一下后更新状态
      setTimeout(() => updateStatus(), 1000);
    } else {
      showToast(`重连失败: ${data.error}`, 'error');
    }
  } catch (e) {
    showToast('重连请求失败: 网络错误', 'error');
  } finally {
    // 恢复按钮状态
    reconnectBtn.disabled = false;
    reconnectBtn.textContent = originalText;
  }
}

async function confirmDelete(): Promise<void> {
  // 关闭模态框
  document.getElementById('deleteModal')?.classList.remove('show');

  if (deletePort !== null) {
    // 删除反向代理
    try {
      const res = await fetch(`/_ctc/proxies/${deletePort}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('反向代理已删除');
        updateStatus();
      } else {
        const data = await res.json();
        showToast(`删除失败: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast('删除失败: 网络错误', 'error');
    }
  }

  if (deleteLocalPort !== null) {
    // 删除正向穿透
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
        showToast(`删除失败: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast('删除失败: 网络错误', 'error');
    }
  }

  deletePort = null;
  deleteLocalPort = null;
}

// ========== 反向代理功能 ==========

function initReverseProxy(): void {
  const showAddFormBtn = document.getElementById('showAddForm');
  const cancelAddBtn = document.getElementById('cancelAdd');
  const addProxyBtn = document.getElementById('addProxy');
  const addForm = document.getElementById('addForm');

  showAddFormBtn?.addEventListener('click', () => {
    addForm?.classList.add('show');
  });

  cancelAddBtn?.addEventListener('click', () => {
    addForm?.classList.remove('show');
  });

  addProxyBtn?.addEventListener('click', async () => {
    const remotePortInput = document.getElementById('newRemotePort') as HTMLInputElement;
    const localPortInput = document.getElementById('newLocalPort') as HTMLInputElement;
    const localHostInput = document.getElementById('newLocalHost') as HTMLInputElement;

    const remotePort = parseInt(remotePortInput.value);
    const localPort = parseInt(localPortInput.value);
    const localHost = localHostInput.value || 'localhost';

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
        addForm?.classList.remove('show');
        remotePortInput.value = '';
        localPortInput.value = '';
        localHostInput.value = 'localhost';
        updateStatus();
      } else {
        const data = await res.json();
        showToast(`添加失败: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast('添加失败: 网络错误', 'error');
    }
  });
}

// ========== 正向穿透功能 ==========

async function loadForwardList(): Promise<void> {
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

function initForwardProxy(): void {
  const refreshClientsBtn = document.getElementById('refreshClients');
  const showForwardFormBtn = document.getElementById('showForwardForm');
  const cancelForwardBtn = document.getElementById('cancelForward');
  const addForwardBtn = document.getElementById('addForward');
  const forwardForm = document.getElementById('forwardForm');

  refreshClientsBtn?.addEventListener('click', () => {
    loadClientsList();
  });

  // 测试反向代理
  const testReverseBtn = document.getElementById('testReverse');
  testReverseBtn?.addEventListener('click', async () => {
    try {
      // 添加测试代理 8080 -> localhost:3000
      const res = await fetch('/_ctc/proxies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remotePort: 8080, localPort: 3000, localHost: 'localhost' })
      });
      if (res.ok) {
        showToast('测试代理已添加');
      updateStatus();
      } else {
        const data = await res.json();
        showToast(`添加失败: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast('测试请求失败: 网络错误', 'error');
    }
  });

  showForwardFormBtn?.addEventListener('click', () => {
    forwardForm?.classList.add('show');
    if (!document.getElementById('clientsList')?.textContent.trim()) {
      loadClientsList();
    }
  });

  cancelForwardBtn?.addEventListener('click', () => {
    forwardForm?.classList.remove('show');
    selectedClientId = '';
    document.querySelectorAll('.client-card').forEach(card => card.classList.remove('selected'));
  });

  addForwardBtn?.addEventListener('click', async () => {
    const localPortInput = document.getElementById('forwardLocalPort') as HTMLInputElement;
    const targetClientIdSelect = document.getElementById('targetClientId') as HTMLSelectElement;
    const targetPortInput = document.getElementById('forwardTargetPort') as HTMLInputElement;

    const localPort = parseInt(localPortInput.value);
    const targetClientId = targetClientIdSelect.value;
    const targetPort = parseInt(targetPortInput.value);

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
        forwardForm?.classList.remove('show');
        localPortInput.value = '';
        targetPortInput.value = '';
        targetClientIdSelect.value = '';
        selectedClientId = '';
        loadForwardList();
      } else {
        showToast(`添加失败: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast('添加失败: 网络错误', 'error');
    }
  });

  const registerBtn = document.getElementById('registerBtn');
  registerBtn?.addEventListener('click', registerClient);
}

// ========== 初始化 ==========

function init(): void {
  // 初始化删除模态框
  const cancelDeleteBtn = document.getElementById('cancelDelete');
  const confirmDeleteBtn = document.getElementById('confirmDelete');

  cancelDeleteBtn?.addEventListener('click', () => {
    document.getElementById('deleteModal')?.classList.remove('show');
    deletePort = null;
    deleteLocalPort = null;
  });

  confirmDeleteBtn?.addEventListener('click', confirmDelete);

  // 初始化反向代理功能
  initReverseProxy();

  // 初始化正向穿透功能
  initForwardProxy();

  // 初始化状态更新
  updateStatus();
  setInterval(updateStatus, 3000);

  // 如果在正向穿透标签页，自动加载客户端列表
  if (currentTab === 'forward') {
    loadClientsList();
    loadForwardList();
  }
}

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
