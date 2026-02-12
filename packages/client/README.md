# @feng3d/ctc

**ctc** 是 **穿透客户端**（Chuantou Client）的缩写。

内网穿透转发系统的客户端，运行在内网机器上，将本地服务暴露到公网。

## 特性

- **每个代理端口同时支持 HTTP/WebSocket/TCP/UDP 四种协议**
- 三通道架构：WebSocket 控制通道 + TCP 二进制数据通道 + UDP 数据通道
- 自动重连机制
- 多代理支持
- 单实例模式：通过 IPC 机制支持动态添加代理映射

## 快速开始

推荐使用 `npx` 直接运行，无需全局安装：

```bash
# 启动客户端（连接本地服务器测试）
npx @feng3d/ctc start -s ws://localhost:9000 -t "my-token" -p "8080:3000:localhost"

# 查询状态
npx @feng3d/ctc status

# 列出代理映射
npx @feng3d/ctc list

# 停止客户端
npx @feng3d/ctc stop
```

## 命令说明

### `start` - 启动客户端

```bash
npx @feng3d/ctc start [选项]
```

**单实例模式**：只允许一个客户端实例运行。如果客户端已运行，后续的 `start` 命令会向已运行的进程添加新的代理映射。

**常用示例：**

```bash
# 指定服务器地址和认证令牌
npx @feng3d/ctc start -s ws://your-server.com:9000 -t "my-token"

# 添加单个代理映射：远程8080端口代理到本地3000端口
npx @feng3d/ctc start -s ws://your-server.com:9000 -t "my-token" -p "8080:3000:localhost"

# 添加多个代理映射
npx @feng3d/ctc start -s ws://your-server.com:9000 -t "my-token" -p "8080:3000:localhost,8081:3001,8082:8080"

# 完整参数示例：指定服务器、令牌、代理和重连配置
npx @feng3d/ctc start -s ws://your-server.com:9000 -t "my-token" -p "8080:3000:localhost" --reconnect-interval 5000 --max-reconnect 10
```

**参数说明：**

| 参数 | 说明 | 示例 | 默认值 |
|------|------|------|--------|
| `-s, --server <url>` | 服务器地址（必填） | `ws://your-server.com:9000` | - |
| `-t, --token <token>` | 认证令牌（必填） | `my-token` | - |
| `-p, --proxies <proxies>` | 代理配置（逗号分隔），格式：`远程端口:本地端口:本地地址` | `8080:3000:localhost` | - |
| `--reconnect-interval <ms>` | 重连间隔（毫秒） | `5000` | `5000` |
| `--max-reconnect <number>` | 最大重连次数 | `10` | `10` |
| `--no-daemon` | 前台运行（不作为后台守护进程） | - | - |
| `-o, --open` | 启动后在浏览器中打开管理页面 | - | - |

### `status` - 查询客户端状态

```bash
npx @feng3d/ctc status
```

**输出示例：**

```
穿透客户端状态
  运行中: 是
  服务器: ws://your-server.com:9000
  PID: 12345
  运行时长: 5分30秒
  代理数量: 2
```

### `list` - 列出代理映射

```bash
npx @feng3d/ctc list
```

**输出示例：**

```
当前代理映射:
  :8080 -> localhost:3000
  :8081 -> localhost:3001
```

### `stop` - 停止客户端

```bash
npx @feng3d/ctc stop
```

停止客户端并清理所有代理映射。

## Web 管理页面

客户端启动后，可以通过浏览器访问本地管理页面：

```
http://127.0.0.1:9001/
```

管理页面提供以下功能：
- 查看客户端连接状态（服务器地址、连接状态、认证状态）
- 查看运行时长和重连次数
- 查看所有已注册的代理映射
- 动态添加新的代理映射
- 删除现有代理映射
- 每 3 秒自动刷新状态

使用 `--open` 参数启动时可自动打开浏览器：

```bash
npx @feng3d/ctc start --open
```

## 单实例模式

客户端采用单实例模式设计：

1. **首次启动**：启动后台守护进程，建立与服务器的连接
2. **再次启动**：如果客户端已运行，则向已运行进程添加新的代理映射
3. **不同服务器**：如果尝试连接到不同的服务器，会提示错误

这种设计简化了多代理的管理，无需为每组代理配置单独启动客户端。

## 代理配置格式

```
remotePort:localPort[:localHost]
```

- `remotePort` - 公网端口
- `localPort` - 本地端口
- `localHost` - 本地地址（可选，默认：localhost）

**推荐**：本地地址为 localhost 时推荐省略，使用 `8080:3000` 而非 `8080:3000:localhost`。

每个代理端口同时支持 HTTP/WebSocket/TCP/UDP 协议。

**示例：**

```
# 单个代理（同时支持 HTTP/WebSocket/TCP/UDP）
8080:3000:localhost

# 完整格式
8082:8080:192.168.1.100

# 多个代理（逗号分隔）
8080:3000:localhost,8081:3001,8082:8080
```

## 作为库使用

```typescript
import { Controller, ProxyManager } from '@feng3d/ctc';
import type { Config } from '@feng3d/chuantou-shared';

const config: Config = {
  serverUrl: 'ws://your-server.com:9000',
  token: 'my-token',
  reconnectInterval: 5000,
  maxReconnectAttempts: 10,
  proxies: [
    { remotePort: 8080, localPort: 3000, localHost: 'localhost' },
    { remotePort: 8081, localPort: 3001, localHost: 'localhost' }
  ]
};

const controller = new Controller(config);
await controller.connect();
```

## 许可证

ISC
