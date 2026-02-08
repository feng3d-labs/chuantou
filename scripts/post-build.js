/**
 * 构建后处理脚本
 * 将 package.json 中对 .ts 文件的引用修改为 .js 和 .d.ts
 * 发布时使用，发布后可恢复原始配置
 *
 * 使用方法：
 *   node scripts/post-build.js transform   # 修改 package.json 用于发布
 *   node scripts/post-build.js restore    # 恢复原始 package.json
 */

const fs = require('fs');
const path = require('path');

const packages = [
  { name: 'shared', dir: path.join(__dirname, '..', 'shared') },
  { name: 'server', dir: path.join(__dirname, '..', 'server') },
  { name: 'client', dir: path.join(__dirname, '..', 'client') },
];

/**
 * 将 src/ 路径转换为 dist/ 路径
 */
function transformPath(filePath) {
  if (typeof filePath !== 'string') return filePath;
  // 处理 ./src/index.ts -> ./dist/index.js
  if (filePath.includes('src/index.ts')) {
    return filePath.replace('src/index.ts', 'dist/index.js');
  }
  // 处理 src/index.ts -> dist/index.d.ts (types 字段)
  if (filePath === 'src/index.ts') {
    return 'dist/index.d.ts';
  }
  // 处理其他 .ts 文件
  if (filePath.endsWith('.ts')) {
    return filePath.replace(/\.ts$/, '.js');
  }
  return filePath;
}

/**
 * 递归转换 exports 对象中的路径
 */
function transformExports(exports) {
  if (!exports) return exports;

  for (const key of Object.keys(exports)) {
    const value = exports[key];

    if (typeof value === 'string') {
      exports[key] = transformPath(value);
    } else if (typeof value === 'object' && value !== null) {
      // 处理嵌套对象，如 { import: "./src/index.ts", types: "./src/index.ts" }
      for (const subKey of Object.keys(value)) {
        if (typeof value[subKey] === 'string') {
          // types 字段特殊处理，指向 .d.ts 文件
          if (subKey === 'types') {
            value[subKey] = './dist/index.d.ts';
          } else {
            value[subKey] = transformPath(value[subKey]);
          }
        }
      }
    }
  }

  return exports;
}

function transformPackageJson(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    console.warn(`package.json not found in ${pkgDir}`);
    return;
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

  // 备份原始 package.json
  const backupPath = path.join(pkgDir, 'package.json.backup');
  fs.copyFileSync(pkgPath, backupPath);

  // 修改 main 字段
  if (pkg.main) {
    pkg.main = transformPath(pkg.main);
  }

  // 修改 types 字段（始终指向 .d.ts 文件）
  if (pkg.types) {
    pkg.types = 'dist/index.d.ts';
  }

  // 修改 exports 字段（支持多种导出格式，提高兼容性）
  if (pkg.exports) {
    pkg.exports = transformExports(pkg.exports);
  }

  // bin 目录保持原样（bin/cli.js 已经是 JavaScript 文件）
  // 不需要修改 bin 字段

  // 添加 type 字段支持 CommonJS/ES Module
  if (!pkg.type) {
    pkg.type = 'commonjs';
  }

  // 更新 files 字段，确保包含 dist、bin 和 src
  const requiredFiles = ['dist', 'src'];
  if (pkg.bin && !pkg.files?.includes('bin')) {
    requiredFiles.push('bin');
  }

  if (!pkg.files) {
    pkg.files = requiredFiles;
  } else {
    requiredFiles.forEach(f => {
      if (!pkg.files.includes(f)) {
        pkg.files.push(f);
      }
    });
  }

  // 写入修改后的 package.json
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  const pkgName = pkg.name || path.basename(pkgDir);
  console.log(`Transformed ${pkgName}'s package.json for publishing`);
  console.log(`  main: ${pkg.main}`);
  console.log(`  types: ${pkg.types}`);
  console.log(`  type: ${pkg.type}`);
  if (pkg.bin) {
    console.log(`  bin: ${JSON.stringify(pkg.bin)}`);
  }
  if (pkg.exports) {
    console.log(`  exports: ${JSON.stringify(pkg.exports)}`);
  }
}

function restorePackageJson(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json');
  const backupPath = path.join(pkgDir, 'package.json.backup');

  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, pkgPath);
    fs.unlinkSync(backupPath);
    console.log(`Restored ${path.basename(pkgDir)}'s package.json`);
  }
}

// 命令行参数
const command = process.argv[2] || 'transform';

if (command === 'transform') {
  packages.forEach(pkg => transformPackageJson(pkg.dir));
  console.log('\nPackage.json files transformed for publishing.');
  console.log('After publishing, run: node scripts/post-build.js restore');
} else if (command === 'restore') {
  packages.forEach(pkg => restorePackageJson(pkg.dir));
  console.log('Package.json files restored to original state.');
} else {
  console.log('Usage: node scripts/post-build.js [transform|restore]');
  process.exit(1);
}
