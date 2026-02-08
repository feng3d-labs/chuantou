# @feng3d/zhuanfa-server

内网穿透转发系统的服务端，负责接收公网请求并转发给内网客户端。

## 特性

- WebSocket 控制通道
- 动态端口分配
- 自动心跳检测
- 多客户端支持
- Token 认证

## 安装

```bash
npm install @feng3d/zhuanfa-server
```

## 使用

### 作为独立服务运行

```bash
# 使用默认配置
zhuanfa-server

# 指定端口
zhuanfa-server --port 9000

# 指定认证令牌
zhuanfa-server --tokens token1,token2,token3

# 使用配置文件
zhuanfa-server --config /path/to/config.json
```

### 作为库使用

```typescript
import { ForwardServer, Config } from '@feng3d/zhuanfa-server';

const config = new Config({
  host: '0.0.0.0',
  controlPort: 9000,
  authTokens: ['your-token'],
  heartbeatInterval: 30000,
  sessionTimeout: 60000
});

const server = new ForwardServer(config);
await server.start();
```

## 配置

### 命令行参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--config` | 配置文件路径 | `~/.zhuanfa/server.json` |
| `--port` | 控制端口 | `9000` |
| `--host` | 监听地址 | `0.0.0.0` |
| `--tokens` | 认证令牌（逗号分隔） | `jidexiugaio` |

### 配置文件

配置文件路径：`~/.zhuanfa/server.json`

```json
{
  "host": "0.0.0.0",
  "controlPort": 9000,
  "authTokens": ["jidexiugaio"],
  "heartbeatInterval": 30000,
  "sessionTimeout": 60000
}
```

## 架构

```
公网用户请求 → 服务端监听端口 → WebSocket 控制通道 → 内网客户端 → 本地服务
```

## 与客户端通信

服务端通过 WebSocket 与客户端保持连接，接收客户端的代理注册，并将公网用户的请求转发给对应的客户端处理。

## 许可证

ISC
