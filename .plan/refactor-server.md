# 重构 Server 包：简化为 3 个功能

## Context

当前服务器代码过于复杂：Config 类包含文件读写、命令行解析、自动生成 token 等逻辑；CLI 只有一个扁平命令；auth.ts 是死代码。需要简化为：**start / status / stop** 三个清晰的操作，支持 `npx @feng3d/chuantou-server start` 方式调用，同时作为库导出。

## 改动概览

| 文件 | 操作 | 说明 |
|------|------|------|
| `server/src/auth.ts` | **删除** | 死代码，认证逻辑已在 control-handler 中 |
| `server/src/config.ts` | **删除** | 用 server.ts 中的简单默认值合并替代 |
| `server/src/server.ts` | **重构** | 接受 `Partial<ServerConfig>` 代替 Config 类；新增 `getStatus()`；新增 `/_chuantou/status` 和 `/_chuantou/stop` HTTP 端点；修复 statsInterval 泄漏 |
| `server/src/index.ts` | **重写** | 导出 `start()`, `status()`, `stop()` 三个函数 + 类型 |
| `server/src/cli.ts` | **重写** | 3 个子命令: `start`, `status`, `stop`；PID 文件管理 |
| `server/src/handlers/control-handler.ts` | **小改** | `Config` → `ServerConfig`，`config.isValidToken()` → `config.authTokens.includes()` |
| handlers/http-proxy.ts, ws-proxy.ts, session-manager.ts | **不改** | 保持原样 |

## 详细设计

### 1. server.ts — 核心重构

```typescript
// 接受 Partial<ServerConfig>，内部填充默认值
constructor(options: Partial<ServerConfig> = {}) {
  this.config = {
    host: options.host ?? '0.0.0.0',
    controlPort: options.controlPort ?? DEFAULT_CONFIG.CONTROL_PORT,
    authTokens: options.authTokens ?? [],
    heartbeatInterval: options.heartbeatInterval ?? DEFAULT_CONFIG.HEARTBEAT_INTERVAL,
    sessionTimeout: options.sessionTimeout ?? DEFAULT_CONFIG.SESSION_TIMEOUT,
    tls: options.tls,
  };
  // ...
}
```

新增 `getStatus()` 方法返回 `ServerStatus`：
```typescript
interface ServerStatus {
  running: boolean;
  host: string;
  controlPort: number;
  tls: boolean;
  uptime: number;
  authenticatedClients: number;
  totalPorts: number;
  activeConnections: number;
}
```

新增 HTTP 端点（复用已有的 httpServer request handler）：
- `GET /_chuantou/status` → 返回 JSON 状态
- `POST /_chuantou/stop` → 触发优雅关闭

修复：存储 statsInterval 引用，stop() 时 clearInterval。
记录 startedAt 时间戳用于计算 uptime。

### 2. index.ts — 3 个导出函数

```typescript
export async function start(options?: Partial<ServerConfig>): Promise<ForwardServer>;
export function status(server: ForwardServer): ServerStatus;
export async function stop(server: ForwardServer): Promise<void>;

// 同时导出类型和类，支持高级用法
export { ForwardServer, ServerStatus } from './server.js';
export { SessionManager } from './session-manager.js';
```

### 3. cli.ts — 3 个子命令

使用 `commander` 的子命令模式：

```
npx @feng3d/chuantou-server start [-p port] [-a host] [-t tokens] [--tls-key path] [--tls-cert path]
npx @feng3d/chuantou-server status
npx @feng3d/chuantou-server stop
```

**start 子命令：**
- 解析 CLI 参数，构建 `Partial<ServerConfig>`
- `--tls-key` 和 `--tls-cert` 读取文件内容
- `--tokens` 逗号分隔
- 调用 `start(options)`，注册 SIGINT/SIGTERM
- 写入 PID 文件到 `~/.chuantou/server.pid`（JSON: `{pid, controlPort, host, tls}`）

**status 子命令：**
- 读取 PID 文件获取 host/port
- HTTP GET `http://{host}:{port}/_chuantou/status`
- 格式化输出状态信息

**stop 子命令：**
- 读取 PID 文件获取 host/port
- HTTP POST `http://{host}:{port}/_chuantou/stop`
- 删除 PID 文件

### 4. control-handler.ts — 最小改动

- `import { Config } from '../config.js'` → `import { ServerConfig } from '@feng3d/chuantou-shared'`
- `private config: Config` → `private config: ServerConfig`
- `this.config.isValidToken(token)` → `this.config.authTokens.includes(token)`

## 实施顺序

1. 删除 `auth.ts`
2. 重构 `server.ts`（新构造函数、getStatus、HTTP 端点、修复泄漏）
3. 更新 `control-handler.ts`（Config → ServerConfig）
4. 重写 `index.ts`（3 个导出函数）
5. 删除 `config.ts`
6. 重写 `cli.ts`（3 个子命令 + PID 文件）
7. 构建验证 `npm run build`
8. 运行测试 `npm test`

## 验证方式

1. `npm run build` — TypeScript 编译无错误
2. `npm test` — 现有测试通过
3. 手动测试 CLI：`npx @feng3d/chuantou-server start` 启动后，新终端执行 `npx @feng3d/chuantou-server status` 和 `stop`
