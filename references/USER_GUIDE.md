# Chuantou 用户指南

内网穿透转发系统的完整使用文档。

## 安装

### Claude Code Skills（推荐）

```bash
npx skills add feng3d-labs/chuantou
```

安装后可在对话中直接使用，如："启动穿透服务端"或"使用穿透客户端连接到服务器"。

### 全局安装

```bash
npm install -g @feng3d/chuantou-server @feng3d/chuantou-client
```

## 使用

### 启动服务端

```bash
npx @feng3d/chuantou-server -p 9000 -t "my-token"
```

选项：
- `-p, --port <port>` - 控制端口（默认: 9000）
- `-a, --host <address>` - 监听地址（默认: 0.0.0.0）
- `-t, --tokens <tokens>` - 认证令牌（逗号分隔，如未设置将自动生成随机token）
- `--tls-key <path>` - TLS 私钥文件路径（启用 HTTPS/WSS）
- `--tls-cert <path>` - TLS 证书文件路径（启用 HTTPS/WSS）

### 启动服务端（启用 TLS）

```bash
npx @feng3d/chuantou-server \
  --tls-key /path/to/key.pem \
  --tls-cert /path/to/cert.pem
```

启用 TLS 后，服务端将使用 HTTPS/WSS 协议，客户端需要使用 `wss://` 连接。

### 启动客户端

```bash
npx @feng3d/chuantou-client \
  -s ws://li.feng3d.com:9000 \
  -t "my-token" \
  -p "8080:http:3000:localhost"
```

选项：
- `-s, --server <url>` - 服务器地址（默认: `ws://li.feng3d.com:9000`）
  - 如果服务端启用了 TLS，使用 `wss://` 协议
- `-t, --token <token>` - 认证令牌
- `-p, --proxies <proxies>` - 代理配置（格式: `remotePort:protocol:localPort:localHost`）

### 访问服务

启动成功后，访问 `http://li.feng3d.com:8080` 即可访问本地的 3000 端口服务。

## 示例

```bash
# HTTP 代理
npx @feng3d/chuantou-client -s ws://li.feng3d.com:9000 -t mytoken -p "8080:http:3000:localhost"

# WebSocket 代理
npx @feng3d/chuantou-client -s ws://li.feng3d.com:9000 -t mytoken -p "8081:ws:3001:localhost"

# 多个代理
npx @feng3d/chuantou-client -s ws://li.feng3d.com:9000 -t mytoken -p "8080:http:3000:localhost,8081:ws:3001:localhost"
```

## 配置文件

### 服务端配置：`~/.chuantou/server.json`

```json
{
  "controlPort": 9000,
  "authTokens": ["token1", "token2"]
}
```

### 客户端配置：`~/.chuantou/client.json`

```json
{
  "serverUrl": "ws://li.feng3d.com:9000",
  "token": "my-token",
  "proxies": [
    { "remotePort": 8080, "protocol": "http", "localPort": 3000 }
  ]
}
```

使用配置文件：`npx @feng3d/chuantou-server -c ~/.chuantou/server.json`

## 快速入门

### 第一次使用

1. 启动服务端（会自动生成 token）：
```bash
npx @feng3d/chuantou-server
# 输出: No auth token configured, generated random token: abc123...
# 输出: Token saved to config file: ~/.chuantou/server.json
```

2. 复制生成的 token，启动客户端：
```bash
npx @feng3d/chuantou-client -t "生成的token" -p "8080:http:3000:localhost"
```

3. 访问 `http://li.feng3d.com:8080` 即可访问本地服务

### 常见使用场景

**场景1：本地开发调试**
- 将本地运行的 Vue/React 开发服务器暴露给外部访问
- 微信公众号开发（需要公网回调）
- 移动端调试本地 API

**场景2：临时文件共享**
- 在局域网内临时共享文件
- 演示本地项目给远程同事

**场景3：WebSocket 测试**
- 测试 WebSocket 服务端
- 实时通信功能调试

## 常见问题

**Q: token 在哪里查看？**
A: 首次启动服务端时会自动生成并保存在 `~/.chuantou/server.json`，也可在控制台输出中看到。

**Q: 客户端连接失败？**
A: 检查：1) 服务端是否已启动 2) token 是否正确 3) 服务器地址和端口是否正确

**Q: 如何同时转发多个端口？**
A: 使用逗号分隔多个代理配置，如 `-p "8080:http:3000,8081:ws:3001"`

**Q: 支持 HTTPS 吗？**
A: 支持！使用 `--tls-key` 和 `--tls-cert` 参数启用 TLS：
```bash
npx @feng3d/chuantou-server --tls-key /path/to/key.pem --tls-cert /path/to/cert.pem
```
启用后客户端需使用 `wss://` 协议连接。
