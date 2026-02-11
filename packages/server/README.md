# @feng3d/cts

**cts** 是 **穿透服务器**（Chuantou Server）的缩写。

内网穿透转发系统的服务端，负责接收公网请求并转发给内网客户端。

## 特性

- WebSocket 控制通道
- 动态端口分配
- 自动心跳检测
- 多客户端支持
- Token 认证
- TLS 加密支持
- 开机自启动
- Web 状态监控

## 快速开始

推荐使用 `npx` 直接运行，无需全局安装：

```bash
# 启动服务器
npx @feng3d/cts start -p 9000 -t "my-token"

# 查询状态
npx @feng3d/cts status

# 停止服务器
npx @feng3d/cts stop
```

## 命令说明

### `start` - 启动服务器

```bash
npx @feng3d/cts start [选项]
```

**常用示例：**

```bash
# 默认配置启动
npx @feng3d/cts start

# 指定端口和 token
npx @feng3d/cts start -p 9000 -t "my-token"

# 多个 token（逗号分隔）
npx @feng3d/cts start -p 9000 -t "token1,token2,token3"

# 完整参数示例
npx @feng3d/cts start -p 9000 -a 0.0.0.0 -t "my-token" --heartbeat-interval 30000 --session-timeout 60000

# 启动后打开浏览器监控页面
npx @feng3d/cts start -p 9000 -t "my-token" --open

# 不注册开机自启动
npx @feng3d/cts start --no-boot
```

**参数说明：**

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `-p, --port <port>` | 控制端口 | `9000` |
| `-a, --host <address>` | 监听地址 | `0.0.0.0` |
| `-t, --tokens <tokens>` | 认证令牌（逗号分隔） | - |
| `--tls-key <path>` | TLS 私钥文件路径 | - |
| `--tls-cert <path>` | TLS 证书文件路径 | - |
| `--heartbeat-interval <ms>` | 心跳间隔（毫秒） | `30000` |
| `--session-timeout <ms>` | 会话超时（毫秒） | `60000` |
| `-o, --open` | 启动后在浏览器中打开状态页面 | - |
| `--no-boot` | 不注册开机自启动 | - |

### `status` - 查询服务器状态

```bash
npx @feng3d/cts status
```

**输出示例：**

```
穿透服务器状态
  运行中: 是
  主机: 0.0.0.0:9000
  TLS: 已禁用
  运行时长: 3600秒
  客户端: 2
  端口: 4
  连接数: 12
  开机自启: 已注册
```

### `stop` - 停止服务器

```bash
npx @feng3d/cts stop
```

停止服务器并取消开机自启动。

## Web 状态监控

服务器启动后，可以通过浏览器访问状态监控页面：

```
http://127.0.0.1:9000/
```

状态页面显示：
- 服务器运行状态（运行中/已停止）
- 监听地址和端口
- 运行时长
- 已认证客户端数量
- 已注册端口数量
- 活跃连接数
- TLS 状态
- 客户端会话列表
- 每 3 秒自动刷新

使用 `--open` 参数启动时可自动打开浏览器：
```bash
npx @feng3d/cts start --open
```

## 多 Token 配置

支持配置多个认证令牌，允许不同的客户端使用各自的令牌连接：

```bash
# 三个客户端使用不同的 token
npx @feng3d/cts start -t "client1-token,client2-token,client3-token"
```

每个客户端连接时使用对应的 token 即可认证成功。

## 架构

```
公网用户请求 -> 服务端监听端口 -> WebSocket 控制通道 -> 内网客户端 -> 本地服务
```

## 许可证

ISC
