# @feng3d/chuantou-client

内网穿透转发系统的客户端，运行在内网机器上，将本地服务暴露到公网。

## 特性

- WebSocket 控制通道
- 自动重连机制
- HTTP/HTTPS 代理
- WebSocket 代理
- 多代理支持

## 安装

```bash
npm install @feng3d/chuantou-client
```

## 使用

### 作为独立服务运行

```bash
# 使用默认配置
chuantou-client

# 指定服务器地址
chuantou-client --server ws://your-server.com:9000

# 指定认证令牌
chuantou-client --token your-token

# 指定代理配置
chuantou-client --proxies "8080:http:3000:localhost,8081:ws:3001"

# 使用配置文件
chuantou-client --config /path/to/config.json
```

### 作为库使用

```typescript
import { Controller, ProxyManager } from '@feng3d/chuantou-client';

const config = {
  serverUrl: 'ws://your-server.com:9000',
  token: 'your-token',
  proxies: [
    { remotePort: 8080, protocol: 'http', localPort: 3000, localHost: 'localhost' },
    { remotePort: 8081, protocol: 'websocket', localPort: 3001, localHost: 'localhost' }
  ]
};

const controller = new Controller(config);
const proxyManager = new ProxyManager(controller);

await controller.connect();
```

## 配置

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--config` | 配置文件路径 | `~/.chuantou/client.json` |
| `--server` | 服务器地址 | `ws://localhost:9000` |
| `--token` | 认证令牌 | `jidexiugaio` |
| `--proxies` | 代理配置 | `8080:http:3000:localhost,8081:ws:3001` |

### 代理配置格式

```
remotePort:protocol:localPort:localHost
```

- `remotePort` - 公网端口
- `protocol` - 协议类型 (`http` 或 `ws`)
- `localPort` - 本地端口
- `localHost` - 本地地址（可选，默认 localhost）

示例：
- `8080:http:3000:localhost` - 将公网 8080 端口的 HTTP 请求转发到本地 3000 端口
- `8081:ws:3001` - 将公网 8081 端口的 WebSocket 连接转发到本地 3001 端口

### 配置文件

配置文件路径：`~/.chuantou/client.json`

```json
{
  "serverUrl": "ws://your-server.com:9000",
  "token": "your-token",
  "reconnectInterval": 5000,
  "maxReconnectAttempts": 10,
  "proxies": [
    { "remotePort": 8080, "protocol": "http", "localPort": 3000, "localHost": "localhost" },
    { "remotePort": 8081, "protocol": "websocket", "localPort": 3001, "localHost": "localhost" }
  ]
}
```

## 工作流程

1. 客户端连接到服务器
2. 发送认证令牌
3. 注册代理服务（指定公网端口和本地服务）
4. 保持心跳连接
5. 接收服务器的转发请求，转发到本地服务
6. 将本地服务的响应返回给服务器

## 断线重连

客户端具有自动重连功能，当与服务器的连接断开时，会自动尝试重新连接。

## 许可证

ISC
