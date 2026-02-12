# 单端口多协议透明转发 — 可行性报告

## 目标

验证通过代理服务器能否将单一端口上的 HTTP、WebSocket、TCP、UDP 四种协议流量透明转发到目标端口（如 `2222 → 22`）。

## 结论

**可行。** 四种协议流量均可透明转发，客户端无感知。

## 技术原理

### TCP 透明转发（覆盖 HTTP / WebSocket / 原始 TCP）

HTTP、WebSocket、原始 TCP 都基于 TCP 传输，转发时**无需解析协议**，只需字节级双向 pipe：

```
客户端 ──TCP──→ 代理 ──TCP──→ 目标服务端
       ←─pipe──     ←─pipe──
```

核心代码仅 4 行：
```typescript
const target = net.connect(targetPort, targetHost)
client.pipe(target)
target.pipe(client)
```

所有 TCP 层协议（HTTP 请求/响应、WebSocket 握手和帧、原始 TCP 数据）都作为字节流透传，代理完全透明。

### UDP 转发

UDP 是无连接协议，需要代理维护**客户端会话**：

```
客户端 ──UDP──→ 代理 ──UDP──→ 目标服务端
       ←─relay─     ←─relay─
```

- 每个客户端（`ip:port`）创建独立的目标 UDP socket
- 客户端数据 → 转发到目标端口
- 目标响应 → 中继回原客户端
- 30 秒无活动自动清理会话，防止资源泄漏

## 测试架构

```
客户端 → :63743(代理) → :63742(echo服务端)

[1] echo 服务端：监听单端口，处理 HTTP/WS/TCP/UDP
[2] 代理服务器：监听单端口，透明转发到服务端
[3] 客户端：连接代理端口，测试全部 4 种协议
```

端口使用 `port: 0` 由操作系统自动分配，避免冲突。

## 测试结果

```
=== 测试结果 ===

  [PASS] HTTP: Status 200, protocol="http", url="/test"
  [PASS] WebSocket: echo="Hello WebSocket", protocol="websocket"
  [PASS] TCP: "[TCP ECHO] TCP:hello_12345"
  [PASS] UDP: echo="UDP:hello_67890", protocol="udp"

=== 全部通过 - 多协议转发可行 ===
```

## 运行方式

```bash
cd labs/multi-proxy && npx tsx index.ts
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `server.ts` | 多协议 echo 服务端（测试目标） |
| `proxy.ts` | 透明转发代理（TCP pipe + UDP relay） |
| `client.ts` | 四种协议的测试客户端 |
| `index.ts` | 入口：启动服务端 → 启动代理 → 客户端测试 |

## 约束

- 纯 Node.js 实现，零第三方依赖
- 代理对协议完全透明，不解析任何应用层内容
- 适用于 `2222 → 22` 等端口转发场景
