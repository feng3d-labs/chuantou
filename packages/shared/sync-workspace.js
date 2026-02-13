#!/usr/bin/env node

/**
 * 同步 workspace 包的 dist 文件到 pnpm 的 .pnpm 存储目录
 *
 * pnpm workspace 使用硬链接来节省空间，但当我们重新构建 shared 包时，
 * .pnpm 目录中的硬链接不会自动更新。这个脚本手动同步文件。
 */

import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceDir = join(__dirname, 'dist');

// 查找 pnpm 的 .pnpm 存储目录
function findPnpmStore(baseDir, maxDepth = 5) {
  let currentDir = baseDir;
  for (let i = 0; i < maxDepth; i++) {
    const pnpmDir = join(currentDir, 'node_modules', '.pnpm');
    if (statSync(pnpmDir, { throwIfNoEntry: false })?.isDirectory()) {
      return pnpmDir;
    }
    currentDir = dirname(currentDir);
  }
  return null;
}

// 从 package.json 读取包名和版本
const pkg = JSON.parse(
  await import('fs/promises').then(fs => fs.readFile(join(__dirname, 'package.json'), 'utf-8'))
);
// pnpm 格式: @scope+name@version
const packageName = pkg.name.replace('/', '+');
const packageVersion = pkg.version;

const pnpmStore = findPnpmStore(__dirname);
if (!pnpmStore) {
  console.warn('Could not find pnpm .pnpm directory, skipping sync');
  process.exit(0);
}

const targetDir = join(pnpmStore, `${packageName}@${packageVersion}`, 'node_modules', pkg.name, 'dist');

// 检查目标目录是否存在
if (!statSync(targetDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.warn(`Target directory does not exist: ${targetDir}`);
  process.exit(0);
}

// 同步文件
console.log(`Syncing ${sourceDir} -> ${targetDir}`);

function syncDir(source, target) {
  const files = readdirSync(source);
  for (const file of files) {
    const sourcePath = join(source, file);
    const targetPath = join(target, file);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      syncDir(sourcePath, targetPath);
    } else if (stat.isFile()) {
      // 检查是否需要更新
      const targetStat = statSync(targetPath, { throwIfNoEntry: false });
      if (!targetStat || stat.mtimeMs > targetStat.mtimeMs) {
        copyFileSync(sourcePath, targetPath);
        console.log(`  Synced: ${file}`);
      }
    }
  }
}

syncDir(sourceDir, targetDir);
console.log('Sync complete!');
