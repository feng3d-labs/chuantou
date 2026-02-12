import { startServer } from './server.js'
import { runAllTests } from './client.js'

const PORT = 9999

async function main() {
  console.log(`\n=== 单端口多协议服务器 PoC ===\n`)
  console.log(`启动服务器，端口 ${PORT} ...\n`)

  const server = await startServer(PORT)

  // 等待服务器就绪
  await new Promise(r => setTimeout(r, 200))

  console.log(`\n运行协议测试 ...\n`)
  const results = await runAllTests(PORT)

  // 输出结果
  console.log('\n=== 测试结果 ===\n')
  let allPassed = true
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL'
    console.log(`  [${status}] ${r.protocol}: ${r.detail}`)
    if (!r.passed) allPassed = false
  }

  console.log(`\n=== ${allPassed ? '全部通过 ✓' : '存在失败 ✗'} ===\n`)

  await server.close()
  process.exit(allPassed ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
