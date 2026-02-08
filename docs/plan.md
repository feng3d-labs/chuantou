# 公网转发内网穿透系统 - 开发计划

## 上下文

开发一个类似于 ngrok/frp 的内网穿透系统，允许局域网内的电脑通过公网服务器对外提供服务。系统分为 client（内网客户端）和 server（公网服务器）两个部分，使用 TypeScript + Node.js 实现。

## 架构设计

```
                              公网服务器 (Server)
                                    |
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
   HTTP监听服务                WebSocket监听服务            控制通道(WS)
   :8080/:8081...                :8080/:8081...              :9000
        │                           │                           │
        │                   根据请求类型转发                      │
        │                   (HTTP→HTTP, WS→WS)              Token认证
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                            ═════════════════════
                                    │
                               Internet/NAT
                            ═════════════════════
                                    │
                        ┌───────────▼────────────┐
                        │    内网客户端 (Client)   │
                        │                        │
                        │  ┌─────────────────┐   │
                        │  │   控制器         │   │
                        │  │ - 连接服务器     │   │
                        │  │ - Token认证      │   │
                        │  │ - 自动重连       │   │
                        │  │ - 心跳           │   │
                        │  └────────┬────────┘   │
                        │           │            │
                        │  ┌────────▼────────┐   │
                        │  │  代理管理器       │   │
                        │  │ - 注册代理        │   │
                        │  │ - 管理连接        │   │
                        │  └────────┬────────┘   │
                        │           │            │
                        │  ┌────────▼────────┐   │
                        │  │  本地服务         │   │
                        │  │  :3000 (HTTP)    │   │
                        │  │  :3001 (WS)      │   │
                        │  └─────────────────┘   │
                        └────────────────────────┘
```

## 技术选型

| 组件 | 技术方案 | 说明 |
|------|---------|------|
| 控制通道 | WebSocket | 双向通信、自动重连、穿透防火墙 |
| 数据传输 | 原样转发 | 用户HTTP请求→HTTP转发，用户WS请求→WS转发 |
| 端口分配 | 客户端指定 | 注册时由客户端指定希望使用的公网端口 |
| 语言 | TypeScript | 类型安全、易于维护 |
| 运行时 | Node.js | 跨平台、丰富的生态 |
| 序列化 | JSON | 易于调试、可扩展 |
| 认证 | Token | 连接时提供token进行认证 |

## 消息协议

### 消息格式
```typescript
interface Message {
  type: MessageType;  // 消息类型
  id: string;        // 消息ID（用于请求-响应匹配）
  payload: any;      // 消息负载
}

enum MessageType {
  // 认证消息
  AUTH = 'auth',               // 客户端认证
  AUTH_RESP = 'auth_resp',     // 认证响应

  // 控制消息
  REGISTER = 'register',       // 客户端注册代理服务
  UNREGISTER = 'unregister',   // 客户端注销代理服务
  REGISTER_RESP = 'register_resp',
  HEARTBEAT = 'heartbeat',     // 心跳
  HEARTBEAT_RESP = 'heartbeat_resp',

  // 连接通知
  NEW_CONNECTION = 'new_connection',    // 新用户连接通知
  CONNECTION_CLOSE = 'connection_close',// 连接关闭通知
  CONNECTION_ERROR = 'connection_error',// 连接错误
}
```

### 关键消息结构

```typescript
// 认证消息（连接后第一条消息）
interface AuthMessage {
  type: MessageType.AUTH;
  id: string;
  payload: {
    token: string;           // 认证token
  };
}

// 注册代理服务
interface RegisterMessage {
  type: MessageType.REGISTER;
  id: string;
  payload: {
    remotePort: number;      // 客户端指定的公网端口
    protocol: 'http' | 'websocket';
    localPort: number;
    localHost?: string;
  };
}

// 注册响应
interface RegisterResponseMessage {
  type: MessageType.REGISTER_RESP;
  id: string;
  payload: {
    success: boolean;
    remotePort?: number;     // 确认分配的端口
    remoteUrl?: string;      // 访问URL
    error?: string;
  };
}

// 新连接通知（服务器→客户端）
interface NewConnectionMessage {
  type: MessageType.NEW_CONNECTION;
  id: string;
  payload: {
    connectionId: string;     // 连接唯一标识
    protocol: 'http' | 'websocket';
    // HTTP相关
    method?: string;
    headers?: Record<string, string>;
    url?: string;
    // WebSocket相关
    wsHeaders?: Record<string, string>;
  };
}
```

## 项目结构

```
zhuanfa/
├── package.json              # 根package.json（workspaces）
├── tsconfig.base.json        # 基础TypeScript配置
├── docs/
│   └── plan.md              # 本计划文档
├── shared/                  # 共享代码
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── messages.ts      # 消息类型定义
│       └── protocol.ts      # 协议工具函数
├── client/                  # 内网客户端
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts         # 客户端入口
│   │   ├── controller.ts    # 控制器（连接管理、重连）
│   │   ├── proxy-manager.ts # 代理管理器
│   │   ├── handlers/
│   │   │   ├── http-handler.ts  # HTTP代理处理
│   │   │   └── ws-handler.ts    # WebSocket代理处理
│   │   └── config.ts        # 配置管理
│   └── config/
│       └── default.json     # 默认配置
└── server/                  # 公网服务器
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── index.ts         # 服务器入口
    │   ├── server.ts        # HTTP/WebSocket服务器
    │   ├── session-manager.ts   # 客户端会话管理
    │   ├── port-registry.ts     # 端口注册表
    │   ├── auth.ts          # Token认证
    │   ├── handlers/
    │   │   ├── http-proxy.ts    # HTTP请求代理处理
    │   │   ├── ws-proxy.ts      # WebSocket代理处理
    │   │   └── control-handler.ts # 控制消息处理
    │   └── config.ts        # 配置管理
    └── config/
        └── default.json     # 默认配置
```

## 实现步骤

### 第一阶段：基础框架搭建

#### 1.1 项目配置初始化
- [ ] 创建根目录 `package.json`（workspaces 模式）
- [ ] 创建 `tsconfig.base.json`
- [ ] 创建 `shared/package.json`
- [ ] 创建 `client/package.json` 和 `server/package.json`
- [ ] 配置 ESLint、Prettier
- [ ] 配置构建脚本（npm scripts）

#### 1.2 共享消息定义
- [ ] 创建 `shared/src/messages.ts` 消息类型定义
- [ ] 创建 `shared/src/protocol.ts` 协议工具函数
- [ ] 消息序列化/反序列化工具

### 第二阶段：服务端实现

#### 2.1 核心服务器 (`server/src/server.ts`)
- [ ] HTTP 服务器（使用 http 模块）
- [ ] WebSocket 服务器（使用 ws 库）
- [ ] 控制通道 WebSocket 端点 (port 9000)

#### 2.2 Token认证 (`server/src/auth.ts`)
- [ ] Token验证逻辑
- [ ] 支持配置文件中的token列表

#### 2.3 会话管理 (`server/src/session-manager.ts`)
- [ ] 客户端会话存储
- [ ] 心跳检测
- [ ] 会话超时清理
- [ ] 断线处理

#### 2.4 端口注册表 (`server/src/port-registry.ts`)
- [ ] 端口与客户端映射
- [ ] 端口占用检查
- [ ] 端口释放

#### 2.5 代理处理器
- [ ] HTTP代理 (`server/src/handlers/http-proxy.ts`)
  - [ ] 接收用户HTTP请求
  - [ ] 通过控制通道通知客户端
  - [ ] 接收客户端响应并返回用户
  - [ ] 处理连接关闭
- [ ] WebSocket代理 (`server/src/handlers/ws-proxy.ts`)
  - [ ] 接收用户WS连接
  - [ ] 通过控制通道通知客户端
  - [ ] 双向消息转发
  - [ ] 处理连接关闭

### 第三阶段：客户端实现

#### 3.1 控制器 (`client/src/controller.ts`)
- [ ] 连接到服务器控制端口
- [ ] Token认证
- [ ] 自动重连机制（指数退避）
- [ ] 心跳发送
- [ ] 消息收发

#### 3.2 代理管理 (`client/src/proxy-manager.ts`)
- [ ] 向服务器注册代理
- [ ] 代理注销
- [ ] 代理状态管理

#### 3.3 代理处理器
- [ ] HTTP处理器 (`client/src/handlers/http-handler.ts`)
  - [ ] 接收来自服务器的HTTP请求通知
  - [ ] 建立到本地服务的HTTP连接
  - [ ] 转发请求到本地
  - [ ] 返回响应给服务器
- [ ] WebSocket处理器 (`client/src/handlers/ws-handler.ts`)
  - [ ] 接收来自服务器的WS连接通知
  - [ ] 建立到本地的WS连接
  - [ ] 双向消息转发

### 第四阶段：测试与优化

#### 4.1 功能测试
- [ ] 端到端测试（本地测试）
- [ ] HTTP 代理测试
- [ ] WebSocket 代理测试
- [ ] Token认证测试
- [ ] 多客户端测试
- [ ] 长连接稳定性测试

#### 4.2 可靠性优化
- [ ] 断线重连测试
- [ ] 心跳超时处理
- [ ] 错误恢复
- [ ] 资源清理

## 关键实现细节

### 控制通道流程

```
客户端                           服务器
  │                                │
  │ ────(1) WebSocket 连接 ────────>│  (ws://server:9000)
  │                                │
  │ ────(2) Auth ─────────────────>│  { token: "xxx" }
  │                                │
  │ <────(3) AuthResp ─────────────│  { success: true }
  │                                │
  │ ────(4) Register ─────────────>│  { remotePort: 8080, localPort: 3000 }
  │                                │
  │ <────(5) RegisterResp ─────────│  { success: true, remoteUrl: "http://server:8080" }
  │                                │
  │ ────(6) 定期 Heartbeat ───────>│
  │ <───── HeartbeatResp ───────────│
```

### 数据转发流程（HTTP示例）

```
用户                    服务器                  客户端           本地服务
 │                      │                       │                │
 │ ──GET /api──────────>│                       │                │
 │              (port 8080)                      │                │
 │                      │                       │                │
 │                      │ ──NewConnection──────>│                │
 │                      │  (通过控制通道WS)      │                │
 │                      │                       │                │
 │                      │                       │ ──GET /api────>│
 │                      │                       │  (localhost:3000)│
 │                      │                       │                │
 │                      │                       │ <─响应数据──────│
 │                      │ <─响应数据────────────│                │
 │                      │  (通过控制通道WS)      │                │
 │ <─响应────────────────│                       │                │
 │                      │                       │                │
 │ ──连接关闭────────────│                       │                │
 │                      │ ──ConnectionClose────>│                │
 │                      │                       │ ──关闭────────>│
```

### 数据转发流程（WebSocket示例）

```
用户                    服务器                  客户端           本地服务
 │                      │                       │                │
 │ ──WS Upgrade────────>│                       │                │
 │              (port 8081)                      │                │
 │                      │                       │                │
 │                      │ ──NewConnection──────>│                │
 │                      │  { protocol: 'ws' }   │                │
 │                      │                       │                │
 │                      │                       │ ──WS Upgrade──>│
 │                      │                       │  (localhost:3001)│
 │                      │                       │                │
 │ <═════════════════════│═══════════════════════│════════════════│
 │        双向消息转发     │      双向消息转发       │    双向消息    │
 │ <═════════════════════│═══════════════════════│════════════════│
 │                      │                       │                │
 │ ──Close──────────────│                       │                │
 │                      │ ──ConnectionClose────>│                │
 │                      │                       │ ──Close────────>│
```

### 配置文件示例

**服务器配置** (`server/config/default.json`)
```json
{
  "server": {
    "host": "0.0.0.0",
    "controlPort": 9000,
    "httpPort": 8080,
    "wsPort": 8081
  },
  "auth": {
    "tokens": [
      "client-token-1",
      "client-token-2"
    ]
  },
  "session": {
    "heartbeatInterval": 30000,
    "sessionTimeout": 60000
  }
}
```

**客户端配置** (`client/config/default.json`)
```json
{
  "server": {
    "url": "ws://localhost:9000",
    "token": "client-token-1",
    "reconnectInterval": 5000,
    "maxReconnectAttempts": 10
  },
  "proxies": [
    {
      "remotePort": 8080,
      "protocol": "http",
      "localPort": 3000,
      "localHost": "localhost"
    },
    {
      "remotePort": 8081,
      "protocol": "websocket",
      "localPort": 3001,
      "localHost": "localhost"
    }
  ]
}
```

## 依赖包

### 根目录依赖
```json
{
  "workspaces": [
    "shared",
    "client",
    "server"
  ]
}
```

### 共享模块依赖 (`shared/package.json`)
```json
{
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.3.3"
  }
}
```

### 服务端依赖 (`server/package.json`)
```json
{
  "dependencies": {
    "ws": "^8.16.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "@types/uuid": "^9.0.7",
    "nodemon": "^3.0.2",
    "ts-node": "^10.9.2"
  }
}
```

### 客户端依赖 (`client/package.json`)
```json
{
  "dependencies": {
    "ws": "^8.16.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "@types/uuid": "^9.0.7",
    "nodemon": "^3.0.2",
    "ts-node": "^10.9.2"
  }
}
```

## 验证测试计划

### 1. 本地环境测试
```bash
# 安装依赖
npm install

# 启动服务器
npm run start:server

# 启动客户端
npm run start:client

# 测试HTTP代理（假设本地运行一个 :3000 的 HTTP 服务）
curl http://localhost:8080/api

# 测试WebSocket代理
wscat -c ws://localhost:8081
```

### 2. 功能验证清单
- [ ] 客户端能成功连接服务器控制端口
- [ ] Token认证成功
- [ ] 注册代理后端口被正确占用
- [ ] 通过公网端口能访问本地 HTTP 服务
- [ ] WebSocket 连接能正常双向通信
- [ ] 客户端断开后能自动重连
- [ ] 心跳超时后服务器正确清理会话和端口
- [ ] 多个客户端能同时注册不同端口
- [ ] 连接关闭后资源正确释放

## 关键文件清单

| 文件 | 用途 |
|------|------|
| `shared/src/messages.ts` | 共享消息类型定义 |
| `shared/src/protocol.ts` | 协议工具函数 |
| `server/src/server.ts` | 服务器入口，HTTP+WS服务器 |
| `server/src/auth.ts` | Token认证逻辑 |
| `server/src/session-manager.ts` | 客户端会话管理 |
| `server/src/port-registry.ts` | 端口与客户端映射管理 |
| `server/src/handlers/http-proxy.ts` | HTTP请求代理 |
| `server/src/handlers/ws-proxy.ts` | WebSocket代理 |
| `server/src/handlers/control-handler.ts` | 控制消息处理 |
| `client/src/controller.ts` | 客户端控制器，连接和重连 |
| `client/src/proxy-manager.ts` | 代理注册管理 |
| `client/src/handlers/http-handler.ts` | HTTP请求转发处理 |
| `client/src/handlers/ws-handler.ts` | WebSocket消息转发处理 |
