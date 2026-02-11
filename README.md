# Chuantou - 穿透内网穿透转发系统

类似于 ngrok/frp 的内网穿透系统，将局域网服务暴露到公网。

## 安装

### 方式一：Claude Code Skills（推荐）

```bash
npx skills add feng3d-labs/chuantou
```

安装后可在对话中直接使用，如："启动穿透服务端"或"使用穿透客户端连接到服务器"。

### 方式二：npx 直接运行

```bash
# 服务端
npx @feng3d/cts -p 9000 -t mytoken

# 客户端
npx @feng3d/chuantou-client -s ws://li.feng3d.com:9000 -t mytoken -p "8080:http:3000:localhost"
```

### 方式三：全局安装

```bash
npm install -g @feng3d/cts @feng3d/chuantou-client
```

## 使用

### 启动服务端

```bash
npx @feng3d/cts -p 9000 -t "my-token"
```

选项：
- `-p, --port <port>` - 控制端口（默认: 9000）
- `-a, --host <address>` - 监听地址（默认: 0.0.0.0）
- `-t, --tokens <tokens>` - 认证令牌（逗号分隔，如未设置将自动生成随机token）
- `--tls-key <path>` - TLS 私钥文件路径（启用 HTTPS/WSS）
- `--tls-cert <path>` - TLS 证书文件路径（启用 HTTPS/WSS）

### 启动服务端（启用 TLS）

```bash
npx @feng3d/cts \
  --tls-key /path/to/key.pem \
  --tls-cert /path/to/cert.pem
```

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

使用配置文件：`npx @feng3d/cts -c ~/.chuantou/server.json`
