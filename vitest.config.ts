import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'test/**/*.test.ts', 'test/**/*.test.js', 'packages/*/test/**/*.test.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'test/',
        '**/*.test.ts',
        '**/*.test.js',
        '**/*.d.ts',
        '**/dist/**',
        '**/test/**',
      ],
      // 覆盖所有源文件
      include: ['packages/*/src/**/*.ts'],
      // 设置覆盖率阈值
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
  },
});
