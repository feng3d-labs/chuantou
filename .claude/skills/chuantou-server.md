# Chuantou Server Skill

穿透内网穿透服务端 - 用于接收客户端连接并转发请求。

## 使用方法

### 启动服务端

```bash
# 默认配置启动（监听 9000 端口）
chuantou-server

# 指定控制端口
chuantou-server -p 8080

# 指定监听地址
chuantou-server -a 0.0.0.0

# 设置认证令牌（多个令牌用逗号分隔）
chuantou-server -t "token1,token2,token3"

# 使用配置文件
chuantou-server -c /path/to/config.json
```

### 配置选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | 控制端口 | `9000` |
| `-a, --host <address>` | 监听地址 | `0.0.0.0` |
| `-t, --tokens <tokens>` | 认证令牌（逗号分隔） | `jidexiugaio` |
| `-c, --config <path>` | 配置文件路径 | - |
| `--heartbeat-interval <ms>` | 心跳间隔（毫秒） | `30000` |
| `--session-timeout <ms>` | 会话超时（毫秒） | `60000` |

### 示例

```bash
# 启动监听 8080 端口的服务端
chuantou-server -p 8080

# 使用自定义令牌启动
chuantou-server -t "my-secret-token-123,another-token-456"

# 完整配置示例
chuantou-server -p 9000 -a 0.0.0.0 -t mytoken --heartbeat-interval 30000
```

### 配置文件

配置文件位置: `~/.chuantou/server.json`

```json
{
  "host": "0.0.0.0",
  "controlPort": 9000,
  "authTokens": ["token1", "token2"],
  "heartbeatInterval": 30000,
  "sessionTimeout": 60000
}
```

### 工作流程

1. 服务端启动并监听控制端口
2. 客户端连接并使用令牌认证
3. 客户端注册需要转发的端口和协议
4. 服务端分配公网端口并开始转发请求
5. 定期心跳保持连接活跃
