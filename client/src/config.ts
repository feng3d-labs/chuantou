import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClientConfig, ProxyConfig, DEFAULT_CONFIG } from '@zhuanfa/shared';

/**
 * 获取配置目录路径
 */
function getConfigDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.zhuanfa');
}

/**
 * 获取客户端配置文件路径
 */
function getClientConfigPath(): string {
  return path.join(getConfigDir(), 'client.json');
}

/**
 * 解析代理配置字符串
 * 格式: 8080:http:3000:localhost,8081:ws:3001
 */
function parseProxies(proxiesStr: string): ProxyConfig[] {
  return proxiesStr.split(',').map((p: string) => {
    const parts = p.trim().split(':');
    const protocol = parts[1] === 'ws' ? 'websocket' : parts[1];
    return {
      remotePort: parseInt(parts[0], 10),
      protocol: protocol as 'http' | 'websocket',
      localPort: parseInt(parts[2], 10),
      localHost: parts[3] || 'localhost',
    };
  });
}

/**
 * 解析命令行参数
 */
function parseArgs(): { config?: string; server?: string; token?: string; proxies?: string } {
  const args = process.argv.slice(2);
  const result: { config?: string; server?: string; token?: string; proxies?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config' && i + 1 < args.length) {
      result.config = args[++i];
    } else if (arg === '--server' && i + 1 < args.length) {
      result.server = args[++i];
    } else if (arg === '--token' && i + 1 < args.length) {
      result.token = args[++i];
    } else if (arg === '--proxies' && i + 1 < args.length) {
      result.proxies = args[++i];
    }
  }

  return result;
}

/**
 * 从文件加载配置
 */
async function loadFromFile(configPath: string): Promise<Partial<ClientConfig>> {
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
async function loadConfig(): Promise<ClientConfig> {
  const args = parseArgs();
  let config: ClientConfig = {
    serverUrl: 'ws://localhost:9000',
    token: 'jidexiugaio',
    reconnectInterval: DEFAULT_CONFIG.RECONNECT_INTERVAL,
    maxReconnectAttempts: DEFAULT_CONFIG.MAX_RECONNECT_ATTEMPTS,
    proxies: [
      { remotePort: 8080, protocol: 'http' as const, localPort: 3000, localHost: 'localhost' },
      { remotePort: 8081, protocol: 'websocket' as const, localPort: 3001, localHost: 'localhost' },
    ],
  };

  // 1. 从配置文件加载
  const configPath = args.config || getClientConfigPath();
  const fileConfig = await loadFromFile(configPath);
  Object.assign(config, fileConfig);

  // 2. 命令行参数覆盖
  if (args.server) config.serverUrl = args.server;
  if (args.token) config.token = args.token;
  if (args.proxies) config.proxies = parseProxies(args.proxies);

  return config;
}

/**
 * 客户端配置类
 */
export class Config implements ClientConfig {
  serverUrl: string;
  token: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  proxies: ProxyConfig[];

  constructor(data: ClientConfig) {
    this.serverUrl = data.serverUrl;
    this.token = data.token;
    this.reconnectInterval = data.reconnectInterval;
    this.maxReconnectAttempts = data.maxReconnectAttempts;
    this.proxies = data.proxies;
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
    if (!this.serverUrl) {
      throw new Error('Server URL is required (--server ws://host:port or --config file)');
    }
    if (!this.token) {
      throw new Error('Token is required (--token xxx or --config file)');
    }
    if (!this.serverUrl.startsWith('ws://') && !this.serverUrl.startsWith('wss://')) {
      throw new Error('Server URL must start with ws:// or wss://');
    }
    if (this.proxies.length === 0) {
      throw new Error('At least one proxy configuration is required (--proxies or --config file)');
    }
    for (let i = 0; i < this.proxies.length; i++) {
      const proxy = this.proxies[i];
      if (!proxy.remotePort || proxy.remotePort < 1024 || proxy.remotePort > 65535) {
        throw new Error(`Invalid remotePort in proxy[${i}]: ${proxy.remotePort}`);
      }
      if (!proxy.localPort || proxy.localPort < 1 || proxy.localPort > 65535) {
        throw new Error(`Invalid localPort in proxy[${i}]: ${proxy.localPort}`);
      }
      if (proxy.protocol !== 'http' && proxy.protocol !== 'websocket') {
        throw new Error(`Invalid protocol in proxy[${i}]: ${proxy.protocol}`);
      }
    }
  }
}
