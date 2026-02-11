import { createServer, Socket } from 'net'

const PORT = 3333  // 改成其他端口
const TARGET_HOST = '127.0.0.1'
const TARGET_PORT = 22

const server = createServer((client) => {
  const server = createConnection(TARGET_PORT, TARGET_HOST)

  client.on('data', (data) => server.writable && server.write(data))
  server.on('data', (data) => client.writable && client.write(data))
  server.on('connect', () => console.log(`[连接] ${client.remoteAddress} -> :${TARGET_PORT}`))
  client.on('close', () => server.destroy())
  server.on('close', () => client.destroy())
  client.on('error', (err) => console.error(`[客户端错误]`, err.message))
  server.on('error', (err) => console.error(`[服务端错误]`, err.message))
})

function createConnection(port: number, host: string) {
  const socket = new Socket()
  socket.connect(port, host)
  return socket
}

server.listen(PORT, () => console.log(`TCP转发启动: :${PORT} -> ${TARGET_HOST}:${TARGET_PORT}`))
