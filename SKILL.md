---
name: chuantou
description: Internal network tunneling system for exposing local services to the internet
---

# Chuantou / 穿透

内网穿透转发系统，类似 ngrok/frp，将局域网服务暴露到公网。

## 快速开始

启动服务端：
```bash
npx @feng3d/chuantou-server -p 9000 -t "my-token"
```

启动客户端：
```bash
npx @feng3d/chuantou-client -s ws://server:9000 -t "my-token" -p "8080:http:3000:localhost"
```

## 系统架构

系统由服务端 (server) 和客户端 (client) 组成：

- **服务端**: 监听控制端口，接受客户端连接，分配公网端口
- **客户端**: 连接服务端，建立隧道，转发本地服务流量

通信流程：客户端 → WebSocket → 服务端 → 目标服务

## 命令

### 启动服务端

```bash
npx @feng3d/chuantou-server [选项]
```

选项：
- `-p, --port <端口>` - 控制端口（默认：9000）
- `-a, --host <地址>` - 监听地址（默认：0.0.0.0）
- `-t, --tokens <令牌>` - 认证令牌（逗号分隔）
- `--tls-key <路径>` - TLS 私钥文件（启用 HTTPS/WSS）
- `--tls-cert <路径>` - TLS 证书文件

### 启动客户端

```bash
npx @feng3d/chuantou-client [选项]
```

选项：
- `-s, --server <URL>` - 服务器地址（默认：`ws://li.feng3d.com:9000`）
- `-t, --token <令牌>` - 认证令牌
- `-p, --proxies <配置>` - 代理配置（格式：`远程端口:协议:本地端口:本地地址`）

### 代理配置格式

`远程端口:协议:本地端口:本地地址`

- `远程端口`: 公网访问端口
- `协议`: `http` 或 `ws`（WebSocket）
- `本地端口`: 本地服务端口
- `本地地址`: 本地服务地址（默认：localhost）

## TLS 支持

启用 TLS 加密隧道，在服务端配置：

```bash
npx @feng3d/chuantou-server --tls-key /path/to/key.pem --tls-cert /path/to/cert.pem
```

客户端需使用 `wss://` 协议：
```bash
npx @feng3d/chuantou-client -s wss://server:9000 ...
```

## 配置文件

配置文件存放在 `~/.chuantou/` 目录：

- `server.json` - 服务端配置（端口、令牌）
- `client.json` - 客户端配置（服务器地址、令牌、代理）

加载配置：`npx @feng3d/chuantou-server -c ~/.chuantou/server.json`

## 使用示例

### 场景一：本地开发调试

将本地运行的 Vue/React 开发服务器暴露给外部访问：

```bash
# 服务端（有公网 IP 的机器）
npx @feng3d/chuantou-server -p 9000 -t "dev-token"

# 客户端（本地开发机器）
npx @feng3d/chuantou-client -s ws://服务器IP:9000 -t "dev-token" -p "8080:http:5173:localhost"
```

访问 `http://服务器IP:8080` 即可访问本地开发服务器。

### 场景二：微信公众号开发

需要公网回调地址：

```bash
npx @feng3d/chuantou-client -s ws://服务器IP:9000 -t "my-token" -p "8080:http:3000:localhost"
```

将 `http://服务器IP:8080` 配置为微信回调地址。

### 场景三：同时转发多个端口

```bash
npx @feng3d/chuantou-client \
  -s ws://服务器IP:9000 \
  -t "my-token" \
  -p "8080:http:3000:localhost,8081:ws:3001:localhost,8082:http:8000:localhost"
```

| 远程端口 | 协议 | 本地端口 | 用途 |
|---------|------|----------|------|
| 8080 | http | 3000 | Web 服务 |
| 8081 | ws | 3001 | WebSocket 服务 |
| 8082 | http | 8000 | API 服务 |

### 场景四：启用 TLS 加密

生产环境推荐启用 TLS：

```bash
# 服务端（需要域名和证书）
npx @feng3d/chuantou-server \
  --tls-key /etc/ssl/private/key.pem \
  --tls-cert /etc/ssl/certs/cert.pem \
  -t "prod-token"

# 客户端
npx @feng3d/chuantou-client \
  -s wss://你的域名.com:9000 \
  -t "prod-token" \
  -p "8443:http:3000:localhost"
```

## 首次使用流程

1. **准备服务器**：需要一台有公网 IP 的机器

2. **启动服务端**：
```bash
npx @feng3d/chuantou-server -p 9000 -t "my-secret-token"
# 输出会显示生成的令牌（如未指定）
```

3. **启动客户端**（在本地机器）：
```bash
npx @feng3d/chuantou-client \
  -s ws://服务器IP:9000 \
  -t "my-secret-token" \
  -p "8080:http:3000:localhost"
```

4. **访问服务**：打开浏览器访问 `http://服务器IP:8080`

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 连接失败 | 检查服务端是否运行、令牌是否正确、地址是否正确、防火墙是否开放端口 |
| 端口被占用 | 使用 `-p` 选项指定其他端口 |
| TLS 错误 | 服务端启用 TLS 后，客户端必须使用 `wss://` 协议 |
| 隧道断开 | 客户端会自动重连，检查网络稳定性 |
| 无法访问本地服务 | 确认本地服务已启动，端口和地址配置正确 |
