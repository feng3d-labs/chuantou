/**
 * @module config
 *
 * 客户端配置管理模块。
 *
 * 负责从配置文件、命令行参数和默认值中加载、合并和验证客户端配置。
 * 配置优先级：命令行参数 > 配置文件 > 默认值。
 * 默认配置文件路径为用户主目录下的 `.chuantou/client.json`。
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClientConfig, ProxyConfig, DEFAULT_CONFIG } from '@feng3d/chuantou-shared';

/**
 * 获取配置目录路径。
 *
 * @returns 用户主目录下的 `.chuantou` 目录绝对路径
 */
function getConfigDir(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.chuantou');
}

/**
 * 获取客户端配置文件的完整路径。
 *
 * @returns 配置文件 `client.json` 的绝对路径
 */
function getClientConfigPath(): string {
  return path.join(getConfigDir(), 'client.json');
}

/**
 * 解析代理配置字符串为代理配置数组。
 *
 * 字符串格式为逗号分隔的代理项，每项格式为 `remotePort:protocol:localPort[:localHost]`。
 *
 * @example
 * ```
 * parseProxies('8080:http:3000:localhost,8081:ws:3001')
 * ```
 *
 * @param proxiesStr - 代理配置字符串，如 `"8080:http:3000:localhost,8081:ws:3001"`
 * @returns 解析后的代理配置数组
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
 * 解析命令行参数。
 *
 * 支持以下命令行选项：
 * - `--config <path>` - 配置文件路径
 * - `--server <url>` - 服务器地址
 * - `--token <token>` - 认证令牌
 * - `--proxies <proxies>` - 代理配置字符串
 *
 * @returns 解析后的命令行参数对象，未指定的参数值为 `undefined`
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
 * 从指定路径的 JSON 文件中加载配置。
 *
 * 如果文件不存在或解析失败，返回空对象。
 *
 * @param configPath - 配置文件的绝对路径
 * @returns 部分客户端配置对象，加载失败时返回空对象
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
 * 加载并合并所有来源的配置。
 *
 * 配置合并优先级（从低到高）：
 * 1. 内置默认值
 * 2. 配置文件中的值
 * 3. 命令行参数
 *
 * @returns 合并后的完整客户端配置对象
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
 * 客户端配置类。
 *
 * 实现 {@link ClientConfig} 接口，封装了客户端运行所需的全部配置项，
 * 提供配置加载和验证功能。
 *
 * @example
 * ```typescript
 * const config = await Config.load();
 * config.validate();
 * console.log(config.serverUrl);
 * ```
 */
export class Config implements ClientConfig {
  /** 服务器 WebSocket 连接地址，如 `ws://localhost:9000` */
  serverUrl: string;

  /** 客户端认证令牌，用于与服务器进行身份验证 */
  token: string;

  /** 断线重连间隔时间（毫秒） */
  reconnectInterval: number;

  /** 最大重连尝试次数，超过后停止重连 */
  maxReconnectAttempts: number;

  /** 代理隧道配置列表 */
  proxies: ProxyConfig[];

  /**
   * 创建配置实例。
   *
   * @param data - 客户端配置数据对象
   */
  constructor(data: ClientConfig) {
    this.serverUrl = data.serverUrl;
    this.token = data.token;
    this.reconnectInterval = data.reconnectInterval;
    this.maxReconnectAttempts = data.maxReconnectAttempts;
    this.proxies = data.proxies;
  }

  /**
   * 从配置文件和命令行参数中加载配置并创建实例。
   *
   * 优先使用命令行参数中的值覆盖配置文件中的值。
   *
   * @returns 加载完成的 Config 实例
   */
  static async load(): Promise<Config> {
    const config = await loadConfig();
    return new Config(config);
  }

  /**
   * 验证配置的合法性。
   *
   * 检查以下内容：
   * - 服务器地址不为空且以 `ws://` 或 `wss://` 开头
   * - 认证令牌不为空
   * - 至少配置了一个代理
   * - 每个代理的端口号和协议类型合法
   *
   * @throws {Error} 当配置项不合法时抛出错误，包含具体的错误描述
   */
  validate(): void {
    if (!this.serverUrl) {
      throw new Error('服务器地址是必需的 (--server ws://host:port 或 --config 配置文件)');
    }
    if (!this.token) {
      throw new Error('认证令牌是必需的 (--token xxx 或 --config 配置文件)');
    }
    if (!this.serverUrl.startsWith('ws://') && !this.serverUrl.startsWith('wss://')) {
      throw new Error('服务器地址必须以 ws:// 或 wss:// 开头');
    }
    if (this.proxies.length === 0) {
      throw new Error('至少需要一个代理配置 (--proxies 或 --config 配置文件)');
    }
    for (let i = 0; i < this.proxies.length; i++) {
      const proxy = this.proxies[i];
      if (!proxy.remotePort || proxy.remotePort < 1024 || proxy.remotePort > 65535) {
        throw new Error(`proxy[${i}] 的 remotePort 无效: ${proxy.remotePort}`);
      }
      if (!proxy.localPort || proxy.localPort < 1 || proxy.localPort > 65535) {
        throw new Error(`proxy[${i}] 的 localPort 无效: ${proxy.localPort}`);
      }
      if (proxy.protocol !== 'http' && proxy.protocol !== 'websocket') {
        throw new Error(`proxy[${i}] 的 protocol 无效: ${proxy.protocol}`);
      }
    }
  }
}
