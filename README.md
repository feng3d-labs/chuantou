# Zhuanfa - 内网穿透转发系统

一个类似于 ngrok/frp 的内网穿透系统，允许局域网内的电脑通过公网服务器对外提供服务。

## 功能特点

- **HTTP 代理**: 将本地 HTTP 服务暴露到公网
- **WebSocket 代理**: 支持 WebSocket 连接的代理转发
- **Token 认证**: 客户端连接需要 token 认证
- **自动重连**: 客户端断线自动重连（指数退避）
- **心跳保活**: 定期心跳检测，自动清理超时会话
- **端口管理**: 客户端指定公网端口进行映射

## 项目结构

```
zhuanfa/
├── shared/          # 共享代码（消息类型、协议定义）
├── server/          # 公网服务器
├── client/          # 内网客户端
└── docs/            # 文档
```

## 快速开始

### 安装

```bash
npm install
npm run build
```

### 配置服务器

编辑 `server/config/default.json`:

```json
{
  "host": "0.0.0.0",
  "controlPort": 9000,
  "authTokens": [
    "your-token-here"
  ],
  "heartbeatInterval": 30000,
  "sessionTimeout": 60000
}
```

### 启动服务器

```bash
npm run start:server
```

### 配置客户端

编辑 `client/config/default.json`:

```json
{
  "serverUrl": "ws://your-server-ip:9000",
  "token": "your-token-here",
  "reconnectInterval": 5000,
  "maxReconnectAttempts": 10,
  "proxies": [
    {
      "remotePort": 8080,
      "protocol": "http",
      "localPort": 3000,
      "localHost": "localhost"
    },
    {
      "remotePort": 8081,
      "protocol": "websocket",
      "localPort": 3001,
      "localHost": "localhost"
    }
  ]
}
```

### 启动客户端

```bash
npm run start:client
```

## 使用示例

### 测试 HTTP 代理

1. 在本地启动一个 HTTP 服务（端口 3000）
2. 启动服务器和客户端
3. 访问 `http://your-server-ip:8080` 即可访问本地服务

### 测试 WebSocket 代理

1. 在本地启动一个 WebSocket 服务（端口 3001）
2. 启动服务器和客户端
3. 连接 `ws://your-server-ip:8081` 即可连接本地 WebSocket 服务

## 开发

### 开发模式

```bash
# 开发服务器
npm run dev:server

# 开发客户端
npm run dev:client
```

### 构建

```bash
npm run build
```

## 协议

系统使用 WebSocket 作为控制通道，消息格式如下：

```typescript
interface Message {
  type: MessageType;
  id: string;
  payload: any;
}
```

支持的消息类型：
- `AUTH`: 客户端认证
- `REGISTER`: 注册代理服务
- `UNREGISTER`: 注销代理服务
- `HEARTBEAT`: 心跳
- `NEW_CONNECTION`: 新用户连接通知
- `CONNECTION_CLOSE`: 连接关闭通知
- `CONNECTION_ERROR`: 连接错误

## License

ISC
