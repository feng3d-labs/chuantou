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
const STARTUP_FILE = join(DATA_DIR, 'ctc-startup.json');
/** 任务/服务名称 */
const TASK_NAME = 'feng3d-ctc';

/**
 * 启动信息接口
 */
export interface StartupInfo {
  /** Node.js 可执行文件的绝对路径 */
  nodePath: string;
  /** CLI 脚本文件的绝对路径 */
  scriptPath: string;
  /** 传递给 start 命令的参数数组 */
  args: string[];
}

function saveStartupInfo(info: StartupInfo): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STARTUP_FILE, JSON.stringify(info, null, 2));
}

function removeStartupInfo(): void {
  try {
    unlinkSync(STARTUP_FILE);
  } catch {
    // ignore
  }
}

// ====== Windows 实现（注册表 Run 键）======

const WIN_REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function getStartupScriptPath(): string {
  return join(DATA_DIR, `${TASK_NAME}.vbs`);
}

function registerWindows(info: StartupInfo): void {
  const serveArgs = info.args.map((a) => (a.includes(' ') ? `""${a}""` : a)).join(' ');
  const command = `""${info.nodePath}"" ""${info.scriptPath}"" start ${serveArgs}`;
  const scriptContent = `Set WshShell = CreateObject("WScript.Shell")\r\nWshShell.Run "${command}", 0, False\r\n`;
  const scriptPath = getStartupScriptPath();

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(scriptPath, scriptContent);

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
  const command = `${info.nodePath} ${info.scriptPath} start ${serveArgs}`;
  const logFile = join(DATA_DIR, 'client.log');

  const unit = `[Unit]
Description=feng3d-ctc 穿透内网穿透客户端
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

  try {
    execSync('loginctl enable-linger', { stdio: 'ignore' });
  } catch {
    // ignore
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
 */
export function isBootRegistered(): boolean {
  const os = platform();
  if (os === 'win32') return isRegisteredWindows();
  if (os === 'linux') return isRegisteredLinux();
  return false;
}
