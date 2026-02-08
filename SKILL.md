---
name: chuantou
description: Internal network tunneling system (like ngrok/frp) for exposing local services to the internet. Use when Claude needs to: (1) Start a tunnel server for NAT traversal, (2) Connect a tunnel client to expose local ports, (3) Configure proxy forwarding (HTTP/WebSocket), (4) Set up TLS/HTTPS for secure tunneling, (5) Debug tunneling connection issues.
---

# Chuantou

内网穿透转发系统，类似 ngrok/frp，将局域网服务暴露到公网。

## Quick Start

启动服务端：
```bash
npx @feng3d/chuantou-server -p 9000 -t "my-token"
```

启动客户端：
```bash
npx @feng3d/chuantou-client -s ws://server:9000 -t "my-token" -p "8080:http:3000:localhost"
```

## Architecture

系统由服务端 (server) 和客户端 (client) 组成：

- **服务端**: 监听控制端口，接受客户端连接，分配公网端口
- **客户端**: 连接服务端，建立隧道，转发本地服务流量

通信流程：客户端 → WebSocket → 服务端 → 目标服务

## Commands

### Start Server

```bash
npx @feng3d/chuantou-server [options]
```

Options:
- `-p, --port <port>` - Control port (default: 9000)
- `-a, --host <address>` - Listen address (default: 0.0.0.0)
- `-t, --tokens <tokens>` - Auth tokens (comma-separated)
- `--tls-key <path>` - TLS private key (enables HTTPS/WSS)
- `--tls-cert <path>` - TLS certificate

### Start Client

```bash
npx @feng3d/chuantou-client [options]
```

Options:
- `-s, --server <url>` - Server URL (default: `ws://li.feng3d.com:9000`)
- `-t, --token <token>` - Auth token
- `-p, --proxies <proxies>` - Proxy config (`remotePort:protocol:localPort:localHost`)

### Proxy Format

`remotePort:protocol:localPort:localHost`

- `remotePort`: Public port on server
- `protocol`: `http` or `ws`
- `localPort`: Local service port
- `localHost`: Local service address (default: localhost)

## TLS Support

For secure tunneling, enable TLS on the server:

```bash
npx @feng3d/chuantou-server --tls-key /path/to/key.pem --tls-cert /path/to/cert.pem
```

Client must then use `wss://` protocol:
```bash
npx @feng3d/chuantou-client -s wss://server:9000 ...
```

## Configuration

Config files are stored in `~/.chuantou/`:

- `server.json` - Server configuration (port, tokens)
- `client.json` - Client configuration (server URL, token, proxies)

Load config: `npx @feng3d/chuantou-server -c ~/.chuantou/server.json`

## Troubleshooting

**Connection failed**: Check server is running, token matches, URL is correct
**Port in use**: Use different port with `-p` option
**TLS errors**: Ensure client uses `wss://` when server has TLS enabled

## Documentation

See [USER_GUIDE.md](references/USER_GUIDE.md) for detailed usage examples and scenarios.
