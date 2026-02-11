import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      // 排除不需要单元测试的文件
      exclude: [
        'node_modules/',
        'test/',
        'dist/',
        '**/*.test.ts',
        '**/*.d.ts',
        // CLI 入口文件 - 通过 E2E 测试覆盖
        'src/cli.ts',
        // 模块入口文件 - 仅做重新导出
        'src/index.ts',
        // 配置文件
        'vitest.config.ts',
      ],
      // 覆盖率配置
      // 部分模块需要真实网络环境，无法通过单元测试完全覆盖
      // 详见 test/COVERAGE.md
      thresholds: {
        lines: 50,
        functions: 60,
        branches: 80,
        statements: 50,
      },
    },
  },
});
