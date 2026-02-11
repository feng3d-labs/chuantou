/**
 * @module boot
 * @description 开机自启动管理模块。
 * 提供跨平台的开机自启动注册、注销和状态查询功能。
 * Windows 使用注册表 Run 键 + VBS 静默启动，Linux 使用 systemd --user 用户级服务。
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

/** 数据目录路径 */
const DATA_DIR = join(homedir(), '.chuantou');
/** 启动配置文件路径 */
const STARTUP_FILE = join(DATA_DIR, 'startup.json');
/** 任务/服务名称 */
const TASK_NAME = 'feng3d-cts';

/**
 * 启动信息接口
 *
 * 保存启动命令的完整信息，用于重建开机自启动任务。
 */
export interface StartupInfo {
  /** Node.js 可执行文件的绝对路径 */
  nodePath: string;
  /** CLI 脚本文件的绝对路径 */
  scriptPath: string;
  /** 传递给 _serve 命令的参数数组 */
  args: string[];
}

/**
 * 保存启动信息到文件
 */
function saveStartupInfo(info: StartupInfo): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STARTUP_FILE, JSON.stringify(info, null, 2));
}

/**
 * 读取启动信息
 */
function loadStartupInfo(): StartupInfo | null {
  try {
    return JSON.parse(readFileSync(STARTUP_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 删除启动信息文件
 */
function removeStartupInfo(): void {
  try {
    unlinkSync(STARTUP_FILE);
  } catch {
    // ignore
  }
}

// ====== Windows 实现（注册表 Run 键）======

/** Windows 注册表 Run 键路径 */
const WIN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/** 获取 Windows 启动 VBS 脚本路径 */
function getStartupScriptPath(): string {
  return join(DATA_DIR, `${TASK_NAME}.vbs`);
}

function registerWindows(info: StartupInfo): void {
  // 生成 .vbs 启动脚本（使用 WScript.Shell.Run 以隐藏窗口方式启动）
  const serveArgs = info.args.map((a) => (a.includes(' ') ? `""${a}""` : a)).join(' ');
  const command = `""${info.nodePath}"" ""${info.scriptPath}"" _serve ${serveArgs}`;
  const scriptContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${command}", 0, False\r\n`;
  const scriptPath = getStartupScriptPath();

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(scriptPath, scriptContent);

  // 通过注册表 Run 键注册开机自启动（无需管理员权限）
  execSync(
    `reg add "${WIN_REG_KEY}" /v "${TASK_NAME}" /t REG_SZ /d "wscript.exe \\"${scriptPath}\\"" /f`,
    { stdio: 'ignore', shell: 'cmd.exe' },
  );
}

function unregisterWindows(): void {
  try {
    execSync(
      `reg delete "${WIN_REG_KEY}" /v "${TASK_NAME}" /f`,
      { stdio: 'ignore', shell: 'cmd.exe' },
    );
  } catch {
    // ignore
  }
  try {
    unlinkSync(getStartupScriptPath());
  } catch {
    // ignore
  }
}

function isRegisteredWindows(): boolean {
  try {
    execSync(
      `reg query "${WIN_REG_KEY}" /v "${TASK_NAME}"`,
      { stdio: 'ignore', shell: 'cmd.exe' },
    );
    return true;
  } catch {
    return false;
  }
}

// ====== Linux 实现（systemd --user）======

function getServiceFilePath(): string {
  return join(homedir(), '.config', 'systemd', 'user', `${TASK_NAME}.service`);
}

function registerLinux(info: StartupInfo): void {
  const serviceDir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(serviceDir, { recursive: true });

  const serveArgs = info.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  const command = `${info.nodePath} ${info.scriptPath} _serve ${serveArgs}`;
  const logFile = join(DATA_DIR, 'server.log');

  const unit = `[Unit]
Description=feng3d-cts 穿透内网穿透服务端
After=network.target

[Service]
Type=simple
ExecStart=${command}
Restart=on-failure
RestartSec=5
StandardOutput=append:${logFile}
StandardError=append:${logFile}

[Install]
WantedBy=default.target
`;

  writeFileSync(getServiceFilePath(), unit);
  execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
  execSync(`systemctl --user enable ${TASK_NAME}.service`, { stdio: 'ignore' });

  // 尝试启用 linger，使服务在用户未登录时也能运行
  try {
    execSync('loginctl enable-linger', { stdio: 'ignore' });
  } catch {
    // ignore - 用户可手动运行 sudo loginctl enable-linger $USER
  }
}

function unregisterLinux(): void {
  try {
    execSync(`systemctl --user disable ${TASK_NAME}.service`, { stdio: 'ignore' });
  } catch {
    // ignore
  }
  try {
    unlinkSync(getServiceFilePath());
  } catch {
    // ignore
  }
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

function isRegisteredLinux(): boolean {
  try {
    const result = execSync(`systemctl --user is-enabled ${TASK_NAME}.service`, {
      encoding: 'utf-8',
    });
    return result.trim() === 'enabled';
  } catch {
    return false;
  }
}

// ====== 公共 API ======

/**
 * 注册开机自启动
 *
 * 将启动信息持久化到磁盘，并根据操作系统注册开机启动任务。
 * Windows 使用注册表 Run 键 + VBS 静默启动，Linux 使用 systemd --user 服务。
 *
 * @param info - 启动信息（Node路径、脚本路径、启动参数）
 */
export function registerBoot(info: StartupInfo): void {
  saveStartupInfo(info);
  const os = platform();
  if (os === 'win32') {
    registerWindows(info);
  } else if (os === 'linux') {
    registerLinux(info);
  } else {
    throw new Error(`不支持在 ${os} 上注册开机自启动`);
  }
}

/**
 * 取消开机自启动
 *
 * 根据操作系统注销开机启动任务，并清理启动配置文件。
 */
export function unregisterBoot(): void {
  const os = platform();
  if (os === 'win32') {
    unregisterWindows();
  } else if (os === 'linux') {
    unregisterLinux();
  }
  removeStartupInfo();
}

/**
 * 查询是否已注册开机自启动
 *
 * @returns 是否已注册
 */
export function isBootRegistered(): boolean {
  const os = platform();
  if (os === 'win32') return isRegisteredWindows();
  if (os === 'linux') return isRegisteredLinux();
  return false;
}
