# 单端口多协议服务器 — 可行性报告

## 目标

验证单一端口能否同时处理 HTTP、WebSocket、TCP、UDP 四种协议。

## 结论

**可行。** 四种协议均可在同一端口号上同时工作。

## 技术原理

### TCP 与 UDP 共享端口号

TCP 和 UDP 是独立的传输层协议，操作系统为它们维护**独立的端口命名空间**。同一端口号可以同时绑定 TCP 和 UDP，互不干扰。

```
端口 9999 ─┬─ TCP（net.createServer）
           └─ UDP（dgram.createSocket）
```

### HTTP / WebSocket / 原始 TCP 复用同一 TCP 端口

三者都基于 TCP 连接，通过检查连接首字节来区分：

| 协议 | 首字节特征 | 路由方式 |
|------|-----------|---------|
| HTTP | 以 `GET`/`POST`/`PUT` 等方法名开头 | 交给 `http.Server` 处理 |
| WebSocket | 以 HTTP Upgrade 请求开头 | `http.Server` 触发 `upgrade` 事件，手动完成握手 |
| 原始 TCP | 不匹配 HTTP 方法名 | 直接作为 TCP 流处理 |

关键技术：
- `net.createServer({ pauseOnConnect: true })` — 暂停连接，读取首字节再路由
- `socket.unshift(data)` — 将已读数据回推到流中，交给 HTTP 解析器
- WebSocket 握手用 `crypto.createHash('sha1')` 计算 `Sec-WebSocket-Accept`
- WebSocket 帧手动解析/构造（opcode、mask、payload length）

## 测试结果

```
=== 测试结果 ===

  [PASS] HTTP: Status 200, protocol="http", url="/test"
  [PASS] WebSocket: echo="Hello WebSocket", protocol="websocket"
  [PASS] TCP: "[TCP ECHO] TCP:hello_12345"
  [PASS] UDP: echo="UDP:hello_67890", protocol="udp"

=== 全部通过 ✓ ===
```

## 运行方式

```bash
cd labs/multi-protocol && npx tsx index.ts
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `server.ts` | 多协议 echo 服务器（纯 Node.js，零依赖） |
| `client.ts` | 四种协议的测试客户端 |
| `index.ts` | 入口：启动服务器 → 运行测试 → 输出结果 |

## 约束

- 纯 Node.js 实现，零第三方依赖
- WebSocket 仅实现文本帧（opcode 0x1），满足验证需求
