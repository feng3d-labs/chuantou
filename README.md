# Chuantou - 穿透内网穿透转发系统

一个类似于 ngrok/frp 的内网穿透系统，允许局域网内的电脑通过公网服务器对外提供服务。

## 功能特点

- **HTTP 代理**: 将本地 HTTP 服务暴露到公网
- **WebSocket 代理**: 支持 WebSocket 连接的代理转发
- **Token 认证**: 客户端连接需要 token 认证
- **自动重连**: 客户端断线自动重连（指数退避）
- **心跳保活**: 定期心跳检测，自动清理超时会话
- **端口管理**: 客户端指定公网端口进行映射

## Claude Code Skills 安装

### 通过 Skills 安装（推荐）

安装 Claude Code Skills 后，可以直接在对话中使用穿透功能：

```bash
# 安装 skills
npx skills add @feng3d/chuantou-skills

# 或从 GitHub 安装
npx skills add https://github.com/feng3d/chuantou
```

安装后，你可以这样使用：

```
用户: 使用穿透客户端连接到 ws://server.com:9000
用户: 启动穿透服务端，监听 9000 端口
```

### 全局安装 CLI

```bash
# 安装服务端 CLI
npm install -g @feng3d/chuantou-server

# 安装客户端 CLI
npm install -g @feng3d/chuantou-client
```

### 使用 npx 直接运行

```bash
# 启动服务端
npx @feng3d/chuantou-server -p 9000 -t mytoken

# 启动客户端
npx @feng3d/chuantou-client -s ws://server.com:9000 -t mytoken -p "8080:http:3000:localhost"
```

## 快速开始

### 1. 启动服务端

```bash
# 使用默认配置启动
npx @feng3d/chuantou-server

# 或指定端口和认证令牌
npx @feng3d/chuantou-server -p 9000 -t "my-token-123"
```

服务端选项：
- `-p, --port <port>` - 控制端口（默认: 9000）
- `-a, --host <address>` - 监听地址（默认: 0.0.0.0）
- `-t, --tokens <tokens>` - 认证令牌，逗号分隔
- `--heartbeat-interval <ms>` - 心跳间隔（默认: 30000）
- `--session-timeout <ms>` - 会话超时（默认: 60000）

### 2. 启动客户端

```bash
# 连接到服务器并转发本地 HTTP 服务
npx @feng3d/chuantou-client \
  -s ws://your-server.com:9000 \
  -t "my-token-123" \
  -p "8080:http:3000:localhost"
```

客户端选项：
- `-s, --server <url>` - 服务器地址
- `-t, --token <token>` - 认证令牌
- `-p, --proxies <proxies>` - 代理配置
  - 格式: `remotePort:protocol:localPort:localHost`
  - 多个代理用逗号分隔
- `--reconnect-interval <ms>` - 重连间隔（默认: 5000）
- `--max-reconnect <number>` - 最大重连次数（默认: 10）

### 3. 访问服务

启动成功后，通过 `http://your-server.com:8080` 即可访问本地的 3000 端口服务。

## 使用示例

### HTTP 代理

```bash
# 将本地 3000 端口的 HTTP 服务暴露到公网 8080 端口
npx @feng3d/chuantou-client \
  -s ws://server.com:9000 \
  -t mytoken \
  -p "8080:http:3000:localhost"
```

### WebSocket 代理

```bash
# 转发 WebSocket 服务
npx @feng3d/chuantou-client \
  -s ws://server.com:9000 \
  -t mytoken \
  -p "8081:ws:3001:localhost"
```

### 同时转发多个服务

```bash
# 同时转发 HTTP 和 WebSocket
npx @feng3d/chuantou-client \
  -s ws://server.com:9000 \
  -t mytoken \
  -p "8080:http:3000:localhost,8081:ws:3001:localhost"
```

## 配置文件

### 服务端配置文件

位置: `~/.chuantou/server.json`

```json
{
  "host": "0.0.0.0",
  "controlPort": 9000,
  "authTokens": ["token1", "token2"],
  "heartbeatInterval": 30000,
  "sessionTimeout": 60000
}
```

### 客户端配置文件

位置: `~/.chuantou/client.json`

```json
{
  "serverUrl": "ws://server.com:9000",
  "token": "your-auth-token",
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

使用配置文件启动：

```bash
# 服务端
npx @feng3d/chuantou-server -c /path/to/server.json

# 客户端
npx @feng3d/chuantou-client -c /path/to/client.json
```

## 开发

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build
```

### 监听模式开发

```bash
# 监听所有项目
npm run watch

# 只监听客户端
npm run watch:client

# 只监听服务端
npm run watch:server
```

### 运行测试

```bash
# 运行测试
npm test

# 监听模式测试
npm run test:watch

# 测试覆盖率
npm run test:coverage
```

## 项目结构

```
chuantou/
├── shared/          # 共享代码（消息类型、协议定义）
│   └── src/
│       ├── messages.ts    # 消息类型定义
│       └── protocol.ts    # 协议常量和配置
├── server/          # 公网服务器
│   └── src/
│       ├── server.ts      # HTTP/WebSocket 服务器
│       ├── session-manager.ts  # 会话管理
│       └── cli.ts         # CLI 入口
├── client/          # 内网客户端
│   └── src/
│       ├── controller.ts  # 连接控制器
│       ├── proxy-manager.ts # 代理管理
│       └── cli.ts         # CLI 入口
├── tests/           # 测试文件
└── .claude/skills/   # Claude Code Skills
```

## 协议

系统使用 WebSocket 作为控制通道，支持以下消息类型：

- `AUTH` - 客户端认证
- `REGISTER` - 注册代理服务
- `UNREGISTER` - 注销代理服务
- `HEARTBEAT` - 心跳保活
- `NEW_CONNECTION` - 新连接通知
- `CONNECTION_CLOSE` - 连接关闭通知

## NPM 包

| 包名 | 说明 |
|------|------|
| `@feng3d/chuantou-shared` | 共享类型和协议定义 |
| `@feng3d/chuantou-server` | 服务端 CLI |
| `@feng3d/chuantou-client` | 客户端 CLI |
| `@feng3d/chuantou-skills` | Claude Code Skills |

## License

ISC
