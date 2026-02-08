# Chuantou Client Skill

穿透内网穿透客户端 - 用于将内网服务暴露到公网。

## 使用方法

### 启动客户端

```bash
# 默认配置启动（连接到 localhost:9000，使用默认令牌）
chuantou-client

# 指定服务器地址
chuantou-client -s ws://your-server.com:9000

# 指定认证令牌
chuantou-client -t your-auth-token

# 配置代理转发（格式: remotePort:protocol:localPort:localHost）
chuantou-client -p "8080:http:3000:localhost,8081:ws:3001"

# 使用配置文件
chuantou-client -c /path/to/config.json
```

### 配置选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-s, --server <url>` | 服务器地址 | `ws://localhost:9000` |
| `-t, --token <token>` | 认证令牌 | `jidexiugaio` |
| `-p, --proxies <proxies>` | 代理配置 | `8080:http:3000:localhost,8081:ws:3001` |
| `-c, --config <path>` | 配置文件路径 | - |
| `--reconnect-interval <ms>` | 重连间隔（毫秒） | `5000` |
| `--max-reconnect <number>` | 最大重连次数 | `10` |

### 代理配置格式

```
remotePort:protocol:localPort:localHost
```

- `remotePort`: 公网访问端口
- `protocol`: `http` 或 `ws` (WebSocket)
- `localPort`: 本地服务端口
- `localHost`: 本地服务地址（可选，默认 localhost）

### 示例

```bash
# 将本地 3000 端口的 HTTP 服务暴露到公网 8080 端口
chuantou-client -s ws://server.com:9000 -t mytoken -p "8080:http:3000:localhost"

# 同时转发 HTTP 和 WebSocket 服务
chuantou-client -p "8080:http:3000:localhost,8081:ws:3001:localhost"
```

### 配置文件

配置文件位置: `~/.chuantou/client.json`

```json
{
  "serverUrl": "ws://your-server.com:9000",
  "token": "your-auth-token",
  "proxies": [
    {
      "remotePort": 8080,
      "protocol": "http",
      "localPort": 3000,
      "localHost": "localhost"
    }
  ]
}
```
