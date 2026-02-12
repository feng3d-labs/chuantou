# @feng3d/chuantou-shared

内网穿透转发系统的共享类型定义、消息协议和数据通道帧协议。

## 特性

- 完整的 TypeScript 类型定义
- 服务端和客户端通用的 JSON 消息协议（控制通道）
- 数据通道二进制帧协议（TCP 帧 + UDP 帧）
- FrameParser 流式帧解析器
- 代理配置类型
- 连接管理类型

## 安装

```bash
npm install @feng3d/chuantou-shared
```

## 使用

```typescript
import { MessageType, ProxyConfig, ClientConfig } from '@feng3d/chuantou-shared';

// 创建代理配置
const proxyConfig: ProxyConfig = {
  remotePort: 8080,
  localPort: 3000,
  localHost: 'localhost'
};
```

## 类型

### ProxyConfig

代理配置接口：

```typescript
interface ProxyConfig {
  remotePort: number;      // 公网端口
  localPort: number;       // 本地端口
  localHost?: string;      // 本地地址（默认：localhost）
}
```

**推荐**：本地地址为 localhost 时推荐省略，使用 `8080:3000` 而非 `8080:3000:localhost`。

每个代理端口同时支持 HTTP/WebSocket/TCP/UDP 协议，无需单独指定协议类型。

### ConnectionProtocol

连接协议类型：

```typescript
type ConnectionProtocol = 'http' | 'websocket' | 'tcp' | 'udp';
```

### ConnectionInfo

连接信息接口：

```typescript
interface ConnectionInfo {
  id: string;                  // 连接唯一 ID
  remoteAddress: string;       // 远程客户端 IP
  protocol: ConnectionProtocol; // 协议类型
  createdAt: number;           // 创建时间戳
}
```

### ClientConfig

客户端配置接口：

```typescript
interface ClientConfig {
  serverUrl: string;              // 服务器地址
  token: string;                  // 认证令牌
  reconnectInterval: number;       // 重连间隔
  maxReconnectAttempts: number;    // 最大重连次数
  proxies: ProxyConfig[];          // 代理配置列表
}
```

### ServerConfig

服务端配置接口：

```typescript
interface ServerConfig {
  host: string;               // 监听地址
  controlPort: number;        // 控制端口
  authTokens: string[];       // 认证令牌列表
  heartbeatInterval: number;  // 心跳间隔
  sessionTimeout: number;     // 会话超时
}
```

## 消息类型（控制通道）

控制通道使用 JSON 消息，通过 WebSocket 传输：

- `AUTH` - 客户端认证
- `AUTH_RESP` - 认证响应
- `REGISTER` - 注册代理服务
- `REGISTER_RESP` - 注册响应
- `UNREGISTER` - 注销代理服务
- `HEARTBEAT` - 心跳
- `HEARTBEAT_RESP` - 心跳响应
- `NEW_CONNECTION` - 新连接通知（包含 protocol 字段：`http`/`websocket`/`tcp`/`udp`）
- `CONNECTION_CLOSE` - 连接关闭通知
- `CONNECTION_ERROR` - 连接错误通知

## 数据通道帧协议

数据通道使用二进制帧协议，分为 TCP 数据通道和 UDP 数据通道。

### TCP 数据通道

TCP 数据通道用于高效传输 HTTP/WebSocket/TCP 的原始二进制数据。

**认证帧**（客户端 → 服务端，建立连接时发送一次）：

```
[0xFD][0x01][36 字节 clientId]
```

**认证响应**（服务端 → 客户端，1 字节）：

```
0x01 = 成功，0x00 = 失败
```

**数据帧**（双向传输）：

```
[4 字节 帧长度 (Big-Endian)][36 字节 connectionId][N 字节 数据]
```

帧长度 = 36 + N（connectionId 长度 + 数据长度）。

### UDP 数据通道

UDP 数据通道用于保留 UDP 语义的数据转发。

**注册帧**（客户端 → 服务端）：

```
[0xFD][0x02][36 字节 clientId]
```

**保活帧**（客户端 → 服务端，每 15 秒发送一次）：

```
[0xFD][0x03][36 字节 clientId]
```

**数据帧**（双向传输）：

```
[36 字节 connectionId][N 字节 数据]
```

### 相关导出

```typescript
// TCP 帧函数
writeTcpAuthFrame(clientId: string): Buffer
writeDataFrame(connectionId: string, data: Buffer): Buffer
parseTcpAuthFrame(data: Buffer): string | null
isDataChannelAuth(data: Buffer): boolean

// UDP 帧函数
writeUdpRegisterFrame(clientId: string): Buffer
writeUdpKeepaliveFrame(clientId: string): Buffer
writeUdpDataFrame(connectionId: string, data: Buffer): Buffer
parseUdpDataFrame(buffer: Buffer): { connectionId: string; data: Buffer } | null
parseUdpControlFrame(buffer: Buffer): { type: 'register' | 'keepalive'; clientId: string } | null

// TCP 流式帧解析器
class FrameParser extends EventEmitter {
  push(chunk: Buffer): void   // 推入 TCP 数据块
  reset(): void                // 重置解析器状态
  // 事件: 'frame' (connectionId: string, data: Buffer)
}

// 常量
AUTH_RESPONSE = { SUCCESS: Buffer<[0x01]>, FAILURE: Buffer<[0x00]> }
```

## 许可证

ISC
