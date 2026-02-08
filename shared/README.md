# @feng3d/chuantou-shared

内网穿透转发系统的共享类型定义和消息协议。

## 特性

- 完整的 TypeScript 类型定义
- 服务端和客户端通用的消息协议
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
  protocol: 'http',
  localPort: 3000,
  localHost: 'localhost'
};

// 创建消息
const message = createMessage(MessageType.REGISTER, {
  remotePort: 8080,
  protocol: 'http',
  localPort: 3000,
  localHost: 'localhost'
});
```

## 类型

### ProxyConfig

代理配置接口：

```typescript
interface ProxyConfig {
  remotePort: number;      // 公网端口
  protocol: 'http' | 'websocket';  // 协议类型
  localPort: number;       // 本地端口
  localHost?: string;      // 本地地址
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

## 消息类型

- `AUTH` - 客户端认证
- `AUTH_RESP` - 认证响应
- `REGISTER` - 注册代理服务
- `REGISTER_RESP` - 注册响应
- `UNREGISTER` - 注销代理服务
- `HEARTBEAT` - 心跳
- `HEARTBEAT_RESP` - 心跳响应
- `NEW_CONNECTION` - 新连接通知
- `CONNECTION_CLOSE` - 连接关闭通知
- `CONNECTION_ERROR` - 连接错误通知

## 许可证

ISC
