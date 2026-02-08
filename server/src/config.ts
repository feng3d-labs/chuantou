import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ServerConfig, DEFAULT_CONFIG } from '@feng3d/zhuanfa-shared';

/**
 * 获取配置目录路径
 */
function getConfigDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.zhuanfa');
}

/**
 * 获取服务器配置文件路径
 */
function getServerConfigPath(): string {
  return path.join(getConfigDir(), 'server.json');
}

/**
 * 解析命令行参数
 */
function parseArgs(): { config?: string; port?: string; tokens?: string; host?: string } {
  const args = process.argv.slice(2);
  const result: { config?: string; port?: string; tokens?: string; host?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      result.config = args[++i];
    } else if (arg === '--port' && i + 1 < args.length) {
      result.port = args[++i];
    } else if (arg === '--tokens' && i + 1 < args.length) {
      result.tokens = args[++i];
    } else if (arg === '--host' && i + 1 < args.length) {
      result.host = args[++i];
    }
  }

  return result;
}

/**
 * 从文件加载配置
 */
async function loadFromFile(configPath: string): Promise<Partial<ServerConfig>> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
}

/**
 * 合并配置（文件 < 命令行参数 < 默认值）
 */
async function loadConfig(): Promise<ServerConfig> {
  const args = parseArgs();
  let config: ServerConfig = {
    host: '0.0.0.0',
    controlPort: DEFAULT_CONFIG.CONTROL_PORT,
    authTokens: ['jidexiugaio'],
    heartbeatInterval: DEFAULT_CONFIG.HEARTBEAT_INTERVAL,
    sessionTimeout: DEFAULT_CONFIG.SESSION_TIMEOUT,
  };

  // 1. 从配置文件加载
  const configPath = args.config || getServerConfigPath();
  const fileConfig = await loadFromFile(configPath);
  Object.assign(config, fileConfig);

  // 2. 命令行参数覆盖
  if (args.host) config.host = args.host;
  if (args.port) config.controlPort = parseInt(args.port, 10);
  if (args.tokens) config.authTokens = args.tokens.split(',');

  return config;
}

/**
 * 配置管理类
 */
export class Config implements ServerConfig {
  host: string;
  controlPort: number;
  authTokens: string[];
  heartbeatInterval: number;
  sessionTimeout: number;

  constructor(data: ServerConfig) {
    this.host = data.host;
    this.controlPort = data.controlPort;
    this.authTokens = data.authTokens;
    this.heartbeatInterval = data.heartbeatInterval;
    this.sessionTimeout = data.sessionTimeout;
  }

  /**
   * 加载配置（从文件或命令行参数）
   */
  static async load(): Promise<Config> {
    const config = await loadConfig();
    return new Config(config);
  }

  /**
   * 验证配置
   */
  validate(): void {
    if (this.controlPort < 1 || this.controlPort > 65535) {
      throw new Error(`Invalid control port: ${this.controlPort}`);
    }
    console.log(`Auth tokens: ${this.authTokens.join(', ')}`);
    if (this.heartbeatInterval < 1000) {
      throw new Error(`Heartbeat interval too short: ${this.heartbeatInterval}ms`);
    }
  }

  /**
   * 验证token
   */
  isValidToken(token: string): boolean {
    return this.authTokens.includes(token);
  }
}
