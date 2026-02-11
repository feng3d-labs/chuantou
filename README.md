# Chuantou - 穿透内网穿透转发系统

类似于 ngrok/frp 的内网穿透系统，将局域网服务暴露到公网。

## 特性

- **每个端口同时支持 HTTP 和 WebSocket 协议**，无需单独配置
- WebSocket 控制通道
- 自动重连机制
- 单实例模式：支持动态添加代理映射
- Token 认证
- TLS 加密支持
- Web 管理页面

## 快速开始

### 方式一：npx 直接运行

```bash
# 服务端
npx @feng3d/cts start -p 9000 -t mytoken

# 客户端（连接本地服务器测试）
npx @feng3d/ctc start -s ws://localhost:9000 -t mytoken -p "8080:3000:localhost"
```

### 方式二：全局安装

```bash
npm install -g @feng3d/cts @feng3d/ctc
```

## 使用

### 启动服务端

```bash
npx @feng3d/cts start -p 9000 -t "my-token"
```

选项：
- `-p, --port <port>` - 控制端口（默认: 9000）
- `-a, --host <address>` - 监听地址（默认: 0.0.0.0）
- `-t, --tokens <tokens>` - 认证令牌（逗号分隔）
- `--tls-key <path>` - TLS 私钥文件路径（启用 HTTPS/WSS）
- `--tls-cert <path>` - TLS 证书文件路径（启用 HTTPS/WSS）
- `-o, --open` - 启动后在浏览器中打开状态页面

### 启动服务端（启用 TLS）

```bash
npx @feng3d/cts start \
  --tls-key /path/to/key.pem \
  --tls-cert /path/to/cert.pem
```

### 启动客户端

```bash
npx @feng3d/ctc start \
  -s ws://your-server.com:9000 \
  -t "my-token" \
  -p "8080:3000:localhost"
```

选项：
- `-s, --server <url>` - 服务器地址（必填，如 `ws://your-server.com:9000`）
  - 如果服务端启用了 TLS，使用 `wss://` 协议
- `-t, --token <token>` - 认证令牌（必填）
- `-p, --proxies <proxies>` - 代理配置（格式: `remotePort:localPort:localHost`）
- `-o, --open` - 启动后在浏览器中打开管理页面

### 访问服务

启动成功后，访问 `http://your-server.com:8080` 即可访问本地的 3000 端口服务。

同一个端口支持 HTTP 和 WebSocket 连接。

## 管理页面

### 服务端管理页面

服务端启动后，可通过浏览器访问状态监控页面：

```
http://your-server.com:9000/
```

显示内容：
- 服务器运行状态
- 监听地址和端口
- 已认证客户端数量
- 已注册端口数量
- 活跃连接数
- 客户端会话列表

### 客户端管理页面

客户端启动后，可通过浏览器访问本地管理页面：

```
http://127.0.0.1:9001/
```

功能：
- 查看客户端连接状态
- 查看已注册的代理映射
- 动态添加/删除代理映射

## 命令说明

### 服务端命令

```bash
# 启动服务器
npx @feng3d/cts start [选项]

# 查询状态
npx @feng3d/cts status

# 停止服务器
npx @feng3d/cts stop
```

### 客户端命令

```bash
# 启动客户端
npx @feng3d/ctc start [选项]

# 查询状态
npx @feng3d/ctc status

# 列出代理映射
npx @feng3d/ctc list

# 停止客户端
npx @feng3d/ctc stop
```

## 代理配置格式

```
remotePort:localPort[:localHost]
```

- `remotePort` - 公网端口
- `localPort` - 本地端口
- `localHost` - 本地地址（可选，默认：localhost）

**推荐**：本地地址为 localhost 时推荐省略，使用 `8080:3000` 而非 `8080:3000:localhost`。

每个代理端口同时支持 HTTP 和 WebSocket 协议。

## 示例

```bash
# 单个代理（同时支持 HTTP 和 WebSocket）
npx @feng3d/ctc start -s ws://your-server.com:9000 -t mytoken -p "8080:3000:localhost"

# 多个代理
npx @feng3d/ctc start -s ws://your-server.com:9000 -t mytoken -p "8080:3000:localhost,8081:3001,8082:8080"
```

## 发布包

- [@feng3d/chuantou-shared](https://www.npmjs.com/package/@feng3d/chuantou-shared) - 共享类型定义
- [@feng3d/ctc](https://www.npmjs.com/package/@feng3d/ctc) - 客户端
- [@feng3d/cts](https://www.npmjs.com/package/@feng3d/cts) - 服务端

## License

ISC
