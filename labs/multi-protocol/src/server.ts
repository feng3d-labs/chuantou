import { createServer as createTcpServer, type Socket } from 'net'
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'http'
import { createSocket as createUdpSocket } from 'dgram'
import { createHash } from 'crypto'

// ====== WebSocket 帧处理（纯 Node.js 实现） ======

/** 解析 WebSocket 帧，返回 opcode 和 payload */
function parseWebSocketFrame(buffer: Buffer): { opcode: number; payload: Buffer } | null {
  if (buffer.length < 2) return null

  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let payloadLength = buffer[1] & 0x7f
  let offset = 2

  if (payloadLength === 126) {
    if (buffer.length < 4) return null
    payloadLength = buffer.readUInt16BE(2)
    offset = 4
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null
    payloadLength = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }

  if (masked) {
    if (buffer.length < offset + 4 + payloadLength) return null
    const mask = buffer.subarray(offset, offset + 4)
    offset += 4
    const payload = Buffer.alloc(payloadLength)
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = buffer[offset + i] ^ mask[i % 4]
    }
    return { opcode, payload }
  }

  if (buffer.length < offset + payloadLength) return null
  return { opcode, payload: buffer.subarray(offset, offset + payloadLength) }
}

/** 构造 WebSocket 文本帧（服务端发送，不需要 mask） */
function buildWebSocketFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8')
  const len = payload.length

  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81 // FIN + text opcode
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }

  return Buffer.concat([header, payload])
}

// ====== 协议检测 ======

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'CONNECT', 'TRACE']

function isHttpData(data: Buffer): boolean {
  if (data.length < 3) return false
  const head = data.toString('ascii', 0, Math.min(data.length, 8))
  return HTTP_METHODS.some(m => head.startsWith(m))
}

// ====== 服务器 ======

export interface MultiProtocolServer {
  port: number
  close(): Promise<void>
}

export function startServer(port: number): Promise<MultiProtocolServer> {
  // HTTP 服务器（不直接监听端口）
  const httpServer = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      protocol: 'http',
      method: req.method,
      url: req.url,
      message: 'Hello from multi-protocol server',
    }))
  })

  // WebSocket 升级处理
  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket) => {
    const key = req.headers['sec-websocket-key']
    if (!key) {
      socket.destroy()
      return
    }

    // 计算 Sec-WebSocket-Accept
    const GUID = '258EAFA5-E914-47DA-95CA-5AB5DC76CB65'
    const accept = createHash('sha1').update(key + GUID).digest('base64')

    // 发送握手响应
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n'
    )

    // 处理 WebSocket 帧
    socket.on('data', (data: Buffer) => {
      const frame = parseWebSocketFrame(data)
      if (!frame) return

      if (frame.opcode === 0x8) {
        // Close 帧
        socket.end()
        return
      }

      if (frame.opcode === 0x1) {
        // Text 帧 - echo 回去
        const msg = frame.payload.toString('utf8')
        const response = JSON.stringify({
          protocol: 'websocket',
          echo: msg,
          message: 'Hello from multi-protocol server (WebSocket)',
        })
        socket.write(buildWebSocketFrame(response))
      }
    })

    socket.on('error', () => {})
  })

  // 原始 TCP echo 处理
  function handleRawTcp(socket: Socket, initialData: Buffer) {
    socket.write(`[TCP ECHO] ${initialData.toString()}`)

    socket.on('data', (data: Buffer) => {
      socket.write(`[TCP ECHO] ${data.toString()}`)
    })

    socket.on('error', () => {})
  }

  // TCP 服务器（协议检测路由）
  const tcpServer = createTcpServer({ pauseOnConnect: true }, (socket: Socket) => {
    socket.once('readable', () => {
      const chunk = socket.read() as Buffer | null
      if (!chunk) {
        socket.resume()
        socket.once('data', (data: Buffer) => route(socket, data))
        return
      }
      route(socket, chunk)
    })
  })

  function route(socket: Socket, data: Buffer) {
    if (isHttpData(data)) {
      socket.unshift(data)
      socket.resume()
      httpServer.emit('connection', socket)
    } else {
      socket.resume()
      handleRawTcp(socket, data)
    }
  }

  // UDP 服务器
  const udpSocket = createUdpSocket('udp4')

  udpSocket.on('message', (msg: Buffer, rinfo) => {
    const response = JSON.stringify({
      protocol: 'udp',
      echo: msg.toString(),
      message: 'Hello from multi-protocol server (UDP)',
    })
    udpSocket.send(response, rinfo.port, rinfo.address)
  })

  return new Promise((resolve, reject) => {
    tcpServer.listen(port, () => {
      // 支持 port 0：TCP 绑定后获取实际端口，UDP 绑到同一端口
      const actualPort = (tcpServer.address() as { port: number }).port
      console.log(`[Server] TCP (HTTP + WebSocket + raw TCP) listening on port ${actualPort}`)

      udpSocket.bind(actualPort, () => {
        console.log(`[Server] UDP listening on port ${actualPort}`)

        resolve({
          port: actualPort,
          close() {
            return new Promise<void>((res) => {
              udpSocket.close(() => {
                httpServer.close(() => {
                  tcpServer.close(() => res())
                })
              })
            })
          },
        })
      })

      udpSocket.on('error', reject)
    })

    tcpServer.on('error', reject)
  })
}
