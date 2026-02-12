import { createServer as createTcpServer, connect as tcpConnect, type Socket } from 'net'
import { createSocket as createUdpSocket, type Socket as UdpSocket } from 'dgram'

export interface Proxy {
  listenPort: number
  targetHost: string
  targetPort: number
  close(): Promise<void>
}

export function startProxy(listenPort: number, targetHost: string, targetPort: number): Promise<Proxy> {
  // ====== TCP 透明转发（覆盖 HTTP/WS/TCP） ======
  const tcpServer = createTcpServer((client: Socket) => {
    const target = tcpConnect(targetPort, targetHost)

    // 双向 pipe
    client.pipe(target)
    target.pipe(client)

    client.on('error', () => target.destroy())
    target.on('error', () => client.destroy())
    client.on('close', () => target.destroy())
    target.on('close', () => client.destroy())
  })

  // ====== UDP 转发 ======
  const udpListener = createUdpSocket('udp4')

  // 每个客户端独立的 UDP 会话
  interface UdpSession {
    targetSocket: UdpSocket
    clientPort: number
    clientAddress: string
    timer: ReturnType<typeof setTimeout>
  }
  const sessions = new Map<string, UdpSession>()
  const SESSION_TIMEOUT = 30_000

  udpListener.on('message', (msg: Buffer, rinfo) => {
    const key = `${rinfo.address}:${rinfo.port}`

    let session = sessions.get(key)
    if (!session) {
      // 为新客户端创建独立的目标 socket
      const targetSocket = createUdpSocket('udp4')

      targetSocket.on('message', (resp: Buffer) => {
        // 将目标响应中继回客户端
        udpListener.send(resp, rinfo.port, rinfo.address)
      })

      targetSocket.on('error', () => {
        sessions.delete(key)
        targetSocket.close()
      })

      session = {
        targetSocket,
        clientPort: rinfo.port,
        clientAddress: rinfo.address,
        timer: setTimeout(() => {
          sessions.delete(key)
          targetSocket.close()
        }, SESSION_TIMEOUT),
      }
      sessions.set(key, session)
    } else {
      // 刷新超时
      clearTimeout(session.timer)
      session.timer = setTimeout(() => {
        sessions.delete(key)
        session!.targetSocket.close()
      }, SESSION_TIMEOUT)
    }

    // 转发到目标
    session.targetSocket.send(msg, targetPort, targetHost)
  })

  return new Promise((resolve, reject) => {
    tcpServer.listen(listenPort, () => {
      // 支持 port 0：TCP 绑定后获取实际端口，UDP 绑到同一端口
      const actualPort = (tcpServer.address() as { port: number }).port
      console.log(`[Proxy] TCP ${actualPort} → ${targetHost}:${targetPort}`)

      udpListener.bind(actualPort, () => {
        console.log(`[Proxy] UDP ${actualPort} → ${targetHost}:${targetPort}`)

        resolve({
          listenPort: actualPort,
          targetHost,
          targetPort,
          close() {
            return new Promise<void>((res) => {
              // 清理所有 UDP 会话
              for (const [, s] of sessions) {
                clearTimeout(s.timer)
                s.targetSocket.close()
              }
              sessions.clear()

              udpListener.close(() => {
                tcpServer.close(() => res())
              })
            })
          },
        })
      })

      udpListener.on('error', reject)
    })

    tcpServer.on('error', reject)
  })
}
