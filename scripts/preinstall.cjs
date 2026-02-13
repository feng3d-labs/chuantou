const os = require('os');
const agent = process.env.npm_config_user_agent || '';
const is_pnpm = agent.includes('pnpm');

if (!is_pnpm) {
  process.stderr.write('\x1b[33m请使用 pnpm 安装依赖: pnpm install\x1b[0m\n');
}
