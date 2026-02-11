import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { ServerConfig, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';

/**
 * TLS 证书配置
 */
export interface TlsConfig {
  key: string;
  cert: string;
}

/**
 * 生成随机token
 */
function generateRandomToken(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 获取配置目录路径
 */
function getConfigDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.chuantou');
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
function parseArgs(): { config?: string; port?: string; tokens?: string; host?: string; tlsKey?: string; tlsCert?: string } {
  const args = process.argv.slice(2);
  const result: { config?: string; port?: string; tokens?: string; host?: string; tlsKey?: string; tlsCert?: string } = {};

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
    } else if (arg === '--tls-key' && i + 1 < args.length) {
      result.tlsKey = args[++i];
    } else if (arg === '--tls-cert' && i + 1 < args.length) {
      result.tlsCert = args[++i];
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
 * 保存配置到文件
 */
async function saveToFile(configPath: string, config: ServerConfig): Promise<void> {
  try {
    // 确保配置目录存在
    const configDir = path.dirname(configPath);
    await fs.mkdir(configDir, { recursive: true });

    // 保存配置（格式化输出）
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.warn('Failed to save config to file:', error);
  }
}

/**
 * 读取 TLS 证书文件
 */
function loadTlsConfig(tlsKeyPath?: string, tlsCertPath?: string): TlsConfig | undefined {
  if (!tlsKeyPath || !tlsCertPath) {
    return undefined;
  }

  try {
    const key = readFileSync(tlsKeyPath, 'utf-8');
    const cert = readFileSync(tlsCertPath, 'utf-8');
    return { key, cert };
  } catch (error) {
    console.warn('Failed to load TLS certificates:', error);
    return undefined;
  }
}

/**
 * 合并配置（文件 < 命令行参数 < 默认值）
 */
async function loadConfig(): Promise<{ config: ServerConfig; tls?: TlsConfig }> {
  const args = parseArgs();
  const defaultConfigPath = getServerConfigPath();
  const configPath = args.config || defaultConfigPath;

  let config: ServerConfig = {
    host: '0.0.0.0',
    controlPort: DEFAULT_CONFIG.CONTROL_PORT,
    authTokens: [],
    heartbeatInterval: DEFAULT_CONFIG.HEARTBEAT_INTERVAL,
    sessionTimeout: DEFAULT_CONFIG.SESSION_TIMEOUT,
  };

  // 1. 从配置文件加载
  const fileConfig = await loadFromFile(configPath);
  Object.assign(config, fileConfig);

  // 2. 命令行参数覆盖（优先级最高）
  if (args.host) config.host = args.host;
  if (args.port) config.controlPort = parseInt(args.port, 10);
  if (args.tokens) {
    config.authTokens = args.tokens.split(',');
  }

  // 3. 如果没有设置token，自动生成一个随机token并保存到配置文件
  if (!config.authTokens || config.authTokens.length === 0) {
    const randomToken = generateRandomToken();
    config.authTokens = [randomToken];
    console.log(`No auth token configured, generated random token: ${randomToken}`);

    // 保存到默认配置文件路径（只有在使用默认配置路径时才保存）
    if (!args.config) {
      await saveToFile(defaultConfigPath, config);
      console.log(`Token saved to config file: ${defaultConfigPath}`);
    }
  }

  // 4. 加载 TLS 证书配置
  const tls = loadTlsConfig(args.tlsKey, args.tlsCert);
  if (tls) {
    console.log(`TLS enabled with key: ${args.tlsKey}, cert: ${args.tlsCert}`);
  }

  return { config, tls };
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
  tls?: TlsConfig;

  constructor(data: ServerConfig, tlsConfig?: TlsConfig) {
    this.host = data.host;
    this.controlPort = data.controlPort;
    this.authTokens = data.authTokens;
    this.heartbeatInterval = data.heartbeatInterval;
    this.sessionTimeout = data.sessionTimeout;
    this.tls = tlsConfig;
  }

  /**
   * 加载配置（从文件或命令行参数）
   */
  static async load(): Promise<Config> {
    const { config, tls } = await loadConfig();
    return new Config(config, tls);
  }

  /**
   * 是否启用了 TLS
   */
  isTlsEnabled(): boolean {
    return this.tls !== undefined;
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
    if (this.isTlsEnabled()) {
      console.log('TLS/SSL is enabled');
    }
  }

  /**
   * 验证token
   */
  isValidToken(token: string): boolean {
    return this.authTokens.includes(token);
  }
}
