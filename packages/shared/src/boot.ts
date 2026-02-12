/**
 * @module boot
 * @description 开机自启动管理模块（服务端/客户端通用）
 * 提供跨平台的开机自启动注册、注销和状态查询功能。
 * Windows 使用注册表 Run 键 + VBS 静默启动，Linux 使用 systemd --user 服务。
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

/** 数据目录路径 */
const DATA_DIR = join(homedir(), '.chuantou');
/** 通用启动配置文件路径（任务类型内部区分） */
const STARTUP_FILE = join(DATA_DIR, 'boot.json');

/**
 * 启动信息接口（通用）
 */
export interface StartupInfo {
  /** 是否为服务端（true=服务端，false=客户端） */
  isServer: boolean;
  /** Node.js 可执行文件的绝对路径 */
  nodePath: string;
  /** CLI 脚本文件的绝对路径 */
  scriptPath: string;
  /** 传递给启动命令的参数数组 */
  args: string[];
}

/**
 * 保存启动信息到文件
 */
export function saveStartupInfo(info: StartupInfo): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STARTUP_FILE, JSON.stringify(info, null, 2));
}

/**
 * 读取启动信息
 */
export function loadStartupInfo(): StartupInfo | null {
  try {
    return JSON.parse(readFileSync(STARTUP_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 删除启动信息文件
 */
export function removeStartupInfo(): void {
  try {
    unlinkSync(STARTUP_FILE);
  } catch {
    // ignore
  }
}

// ====== Windows 实现（注册表 Run 键）======

/** Windows 注册表 Run 键路径 */
const WIN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

/**
 * 获取 Windows 启动 VBS 脚本路径（任务名前缀区分）
 */
function getStartupScriptPath(taskName: string): string {
  return join(DATA_DIR, `${taskName}.vbs`);
}

function registerWindows(info: StartupInfo): void {
  const taskName = info.isServer ? 'feng3d-cts' : 'feng3d-ctc';
  const serveArgs = info.args.map((a) => (a.includes(' ') ? `""${a}""` : a)).join(' ');
  const command = `""${info.nodePath}"" ""${info.scriptPath}"" ${info.isServer ? '_serve' : 'start'} ${serveArgs}`;
  const scriptContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${command}", 0, False\r\n`;
  const scriptPath = getStartupScriptPath(taskName);

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(scriptPath, scriptContent);

  execSync(
    `reg add "${WIN_REG_KEY}" /v "${taskName}" /t REG_SZ /d "wscript.exe \\"${scriptPath}\\"" /f`,
    { stdio: 'ignore', shell: 'cmd.exe' },
  );
}

function unregisterWindows(info: StartupInfo): void {
  const taskName = info.isServer ? 'feng3d-cts' : 'feng3d-ctc';
  try {
    execSync(
      `reg delete "${WIN_REG_KEY}" /v "${taskName}" /f`,
      { stdio: 'ignore', shell: 'cmd.exe' },
    );
  } catch {
    // ignore
  }
  try {
    unlinkSync(getStartupScriptPath(taskName));
  } catch {
    // ignore
  }
}

function isRegisteredWindows(info: StartupInfo): boolean {
  const taskName = info.isServer ? 'feng3d-cts' : 'feng3d-ctc';
  try {
    execSync(
      `reg query "${WIN_REG_KEY}" /v "${taskName}"`,
      { stdio: 'ignore', shell: 'cmd.exe' },
    );
    return true;
  } catch {
    return false;
  }
}

// ====== Linux 实现（systemd --user）======

function getServiceFilePath(info: StartupInfo): string {
  const taskName = info.isServer ? 'feng3d-cts' : 'feng3d-ctc';
  return join(homedir(), '.config', 'systemd', 'user', `${taskName}.service`);
}

function registerLinux(info: StartupInfo): void {
  const serviceDir = join(homedir(), '.config', 'systemd', 'user');
  mkdirSync(serviceDir, { recursive: true });

  const serveArgs = info.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ');
  const command = `${info.nodePath} ${info.scriptPath} ${info.isServer ? '_serve' : 'start'} ${serveArgs}`;
  const logFile = join(DATA_DIR, info.isServer ? 'server.log' : 'client.log');

  const description = info.isServer
    ? 'feng3d-cts 穿透内网穿透服务端'
    : 'feng3d-ctc 穿透内网穿透客户端';

  const unit = `[Unit]
Description=${description}
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

  writeFileSync(getServiceFilePath(info), unit);
  execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
  execSync(`systemctl --user enable ${info.isServer ? 'feng3d-cts' : 'feng3d-ctc'}.service`, { stdio: 'ignore' });

  try {
    execSync('loginctl enable-linger', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

function unregisterLinux(info: StartupInfo): void {
  const taskName = info.isServer ? 'feng3d-cts' : 'feng3d-ctc';
  try {
    execSync(`systemctl --user disable ${taskName}.service`, { stdio: 'ignore' });
  } catch {
    // ignore
  }
  try {
    unlinkSync(getServiceFilePath(info));
  } catch {
    // ignore
  }
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}

function isRegisteredLinux(info: StartupInfo): boolean {
  const taskName = info.isServer ? 'feng3d-cts' : 'feng3d-ctc';
  try {
    const result = execSync(`systemctl --user is-enabled ${taskName}.service`, {
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
 * @param info - 启动信息（包含 isServer 标识、Node路径、脚本路径、启动参数）
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
 * @param info - 启动信息（可选，如果不提供则从文件读取）
 */
export function unregisterBoot(info?: StartupInfo): void {
  const startupInfo = info ?? loadStartupInfo();
  if (!startupInfo) return;

  const os = platform();
  if (os === 'win32') {
    unregisterWindows(startupInfo);
  } else if (os === 'linux') {
    unregisterLinux(startupInfo);
  }
  removeStartupInfo();
}

/**
 * 查询是否已注册开机自启动
 *
 * @param info - 启动信息（可选，如果不提供则从文件读取）
 * @returns 是否已注册
 */
export function isBootRegistered(info?: StartupInfo): boolean {
  const startupInfo = info ?? loadStartupInfo();
  if (!startupInfo) return false;

  const os = platform();
  if (os === 'win32') return isRegisteredWindows(startupInfo);
  if (os === 'linux') return isRegisteredLinux(startupInfo);
  return false;
}
