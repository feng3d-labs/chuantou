import { startEchoServer } from './server.js'
import { runAllTests } from './client.js'
import { startProxy } from './proxy.js'

async function main() {
  console.log(`\n=== 单端口多协议透明转发 PoC ===\n`)

  // 1. 启动 echo 服务端（port 0 自动分配空闲端口）
  console.log(`[1] 启动 echo 服务端 ...`)
  const server = await startEchoServer(0)

  // 2. 启动代理（port 0 自动分配空闲端口，转发到服务端）
  console.log(`[2] 启动代理 → 127.0.0.1:${server.port} ...`)
  const proxy = await startProxy(0, '127.0.0.1', server.port)

  await new Promise(r => setTimeout(r, 200))

  // 3. 客户端通过代理端口测试全部 4 种协议
  console.log(`\n[3] 客户端通过代理端口测试 ...`)
  console.log(`    客户端 → :${proxy.listenPort}(代理) → :${server.port}(服务端)\n`)
  const results = await runAllTests(proxy.listenPort)

  // 4. 输出结果
  console.log('\n=== 测试结果 ===\n')
  let allPassed = true
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL'
    console.log(`  [${status}] ${r.protocol}: ${r.detail}`)
    if (!r.passed) allPassed = false
  }

  console.log(`\n=== ${allPassed ? '全部通过 - 多协议转发可行' : '存在失败'} ===\n`)

  await proxy.close()
  await server.close()
  process.exit(allPassed ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
