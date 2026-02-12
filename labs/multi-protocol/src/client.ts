import { Socket as TcpSocket } from 'net'
import { createSocket } from 'dgram'
import { request } from 'http'
import { randomBytes, createHash } from 'crypto'

export interface TestResult {
  protocol: string
  passed: boolean
  detail: string
}

// ====== HTTP 测试 ======

function testHttp(port: number): Promise<TestResult> {
  return new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port, path: '/test', method: 'GET' }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          const passed = json.protocol === 'http' && json.method === 'GET' && json.url === '/test'
          resolve({ protocol: 'HTTP', passed, detail: `Status ${res.statusCode}, protocol="${json.protocol}", url="${json.url}"` })
        } catch {
          resolve({ protocol: 'HTTP', passed: false, detail: `Invalid JSON: ${body}` })
        }
      })
    })
    req.on('error', (e) => resolve({ protocol: 'HTTP', passed: false, detail: e.message }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ protocol: 'HTTP', passed: false, detail: 'Timeout' }) })
    req.end()
  })
}

// ====== WebSocket 测试（纯 Node.js 手动握手 + 帧处理） ======

/** 构造客户端 WebSocket 帧（需要 mask） */
function buildClientFrame(data: string): Buffer {
  const payload = Buffer.from(data, 'utf8')
  const len = payload.length
  const mask = randomBytes(4)

  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x81
    header[1] = 0x80 | len // masked
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81
    header[1] = 0x80 | 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81
    header[1] = 0x80 | 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }

  const masked = Buffer.alloc(len)
  for (let i = 0; i < len; i++) {
    masked[i] = payload[i] ^ mask[i % 4]
  }

  return Buffer.concat([header, mask, masked])
}

/** 解析服务端 WebSocket 帧（无 mask） */
function parseServerFrame(buffer: Buffer): { payload: string } | null {
  if (buffer.length < 2) return null
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
  if (buffer.length < offset + payloadLength) return null
  return { payload: buffer.subarray(offset, offset + payloadLength).toString('utf8') }
}

function testWebSocket(port: number): Promise<TestResult> {
  return new Promise((resolve) => {
    const key = randomBytes(16).toString('base64')
    const timer = setTimeout(() => resolve({ protocol: 'WebSocket', passed: false, detail: 'Timeout' }), 5000)

    const req = request({
      hostname: '127.0.0.1',
      port,
      path: '/ws',
      method: 'GET',
      headers: {
        'Upgrade': 'websocket',
        'Connection': 'Upgrade',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    })

    req.on('upgrade', (_res, socket) => {
      // 验证握手
      const GUID = '258EAFA5-E914-47DA-95CA-5AB5DC76CB65'
      const expectedAccept = createHash('sha1').update(key + GUID).digest('base64')
      const actualAccept = _res.headers['sec-websocket-accept']
      if (actualAccept !== expectedAccept) {
        clearTimeout(timer)
        socket.destroy()
        resolve({ protocol: 'WebSocket', passed: false, detail: `Handshake failed: expected ${expectedAccept}, got ${actualAccept}` })
        return
      }

      // 发送测试消息
      const testMsg = 'Hello WebSocket'
      socket.write(buildClientFrame(testMsg))

      socket.on('data', (data: Buffer) => {
        clearTimeout(timer)
        const frame = parseServerFrame(data)
        if (!frame) {
          socket.destroy()
          resolve({ protocol: 'WebSocket', passed: false, detail: 'Failed to parse frame' })
          return
        }
        try {
          const json = JSON.parse(frame.payload)
          const passed = json.protocol === 'websocket' && json.echo === testMsg
          resolve({ protocol: 'WebSocket', passed, detail: `echo="${json.echo}", protocol="${json.protocol}"` })
        } catch {
          resolve({ protocol: 'WebSocket', passed: false, detail: `Invalid JSON: ${frame.payload}` })
        }
        // 发送 close 帧
        const closeFrame = Buffer.alloc(6)
        closeFrame[0] = 0x88 // FIN + close
        closeFrame[1] = 0x80 // masked, length 0
        const mask = randomBytes(4)
        mask.copy(closeFrame, 2)
        socket.write(closeFrame)
        socket.destroy()
      })
    })

    req.on('error', (e) => {
      clearTimeout(timer)
      resolve({ protocol: 'WebSocket', passed: false, detail: e.message })
    })

    req.end()
  })
}

// ====== 原始 TCP 测试 ======

function testRawTcp(port: number): Promise<TestResult> {
  return new Promise((resolve) => {
    const client = new TcpSocket()
    const testData = 'TCP:hello_12345'
    const timer = setTimeout(() => { client.destroy(); resolve({ protocol: 'TCP', passed: false, detail: 'Timeout' }) }, 5000)

    client.connect(port, '127.0.0.1', () => {
      client.write(testData)
    })

    client.on('data', (data) => {
      clearTimeout(timer)
      const response = data.toString()
      const passed = response.includes('[TCP ECHO]') && response.includes(testData)
      resolve({ protocol: 'TCP', passed, detail: `"${response.trim()}"` })
      client.destroy()
    })

    client.on('error', (e) => {
      clearTimeout(timer)
      resolve({ protocol: 'TCP', passed: false, detail: e.message })
    })
  })
}

// ====== UDP 测试 ======

function testUdp(port: number): Promise<TestResult> {
  return new Promise((resolve) => {
    const client = createSocket('udp4')
    const testMsg = 'UDP:hello_67890'
    const timer = setTimeout(() => { client.close(); resolve({ protocol: 'UDP', passed: false, detail: 'Timeout' }) }, 5000)

    client.on('message', (msg) => {
      clearTimeout(timer)
      try {
        const json = JSON.parse(msg.toString())
        const passed = json.protocol === 'udp' && json.echo === testMsg
        resolve({ protocol: 'UDP', passed, detail: `echo="${json.echo}", protocol="${json.protocol}"` })
      } catch {
        resolve({ protocol: 'UDP', passed: false, detail: `Invalid JSON: ${msg.toString()}` })
      }
      client.close()
    })

    client.on('error', (e) => {
      clearTimeout(timer)
      resolve({ protocol: 'UDP', passed: false, detail: e.message })
    })

    client.send(testMsg, port, '127.0.0.1')
  })
}

// ====== 导出 ======

export async function runAllTests(port: number): Promise<TestResult[]> {
  const results: TestResult[] = []
  results.push(await testHttp(port))
  results.push(await testWebSocket(port))
  results.push(await testRawTcp(port))
  results.push(await testUdp(port))
  return results
}
