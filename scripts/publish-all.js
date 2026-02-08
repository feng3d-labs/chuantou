#!/usr/bin/env node
/**
 * 统一发布脚本
 * 1. 检查所有包的版本号是否一致
 * 2. 构建所有包
 * 3. 转换 package.json 用于发布
 * 4. 发布所有包到 npm
 * 5. 恢复 package.json
 *
 * 使用方法：
 *   node scripts/publish-all.js           # 发布到 npm
 *   node scripts/publish-all.js --dry-run # 只检查，不实际发布
 *   node scripts/publish-all.js --tag beta # 发布到 beta 标签
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const packages = [
  { name: '@feng3d/chuantou-shared', dir: path.join(__dirname, '..', 'shared') },
  { name: '@feng3d/chuantou-server', dir: path.join(__dirname, '..', 'server') },
  { name: '@feng3d/chuantou-client', dir: path.join(__dirname, '..', 'client') },
  { name: '@feng3d/chuantou', dir: path.join(__dirname, '..') },
];

// 解析命令行参数
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const tagArg = args.find(arg => arg.startsWith('--tag='));
const tag = tagArg ? tagArg.split('=')[1] : 'latest';

/**
 * 获取包的版本号
 */
function getPackageVersion(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * 检查所有包的版本号是否一致
 */
function checkVersions() {
  console.log('检查版本号...\n');

  const versions = packages.map(pkg => ({
    name: pkg.name,
    version: getPackageVersion(pkg.dir)
  }));

  // 显示所有版本号
  versions.forEach(v => {
    console.log(`  ${v.name}: ${v.version}`);
  });

  // 检查是否一致
  const firstVersion = versions[0].version;
  const inconsistent = versions.filter(v => v.version !== firstVersion);

  if (inconsistent.length > 0) {
    console.error('\n❌ 版本号不一致！');
    inconsistent.forEach(v => {
      console.error(`  ${v.name}: ${v.version} (应为 ${firstVersion})`);
    });
    return false;
  }

  console.log(`\n✅ 所有包版本号一致: ${firstVersion}\n`);
  return true;
}

/**
 * 执行命令
 */
function execCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      shell: true,
      ...options
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

/**
 * 主流程
 */
async function main() {
  console.log('========================================');
  console.log('  Chuantou 统一发布脚本');
  console.log('========================================\n');

  if (dryRun) {
    console.log('⚠️  Dry-run 模式，不会实际发布\n');
  }

  // 1. 检查版本号
  if (!checkVersions()) {
    process.exit(1);
  }

  // 2. 构建所有包
  console.log('构建所有包...\n');
  try {
    await execCommand('npm', ['run', 'build:dev'], { cwd: path.join(__dirname, '..') });
  } catch (error) {
    console.error('\n❌ 构建失败');
    process.exit(1);
  }

  // 3. 转换 package.json
  console.log('\n转换 package.json...\n');
  await execCommand('node', ['scripts/post-build.js', 'transform'], {
    cwd: path.join(__dirname, '..')
  });

  // 4. 发布所有包
  if (!dryRun) {
    console.log('\n发布所有包到 npm...\n');

    for (const pkg of packages) {
      console.log(`\n📦 发布 ${pkg.name}...`);

      try {
        const publishArgs = ['publish', '--access', 'public'];
        if (tag !== 'latest') {
          publishArgs.push('--tag', tag);
        }

        await execCommand('npm', publishArgs, { cwd: pkg.dir });
        console.log(`✅ ${pkg.name} 发布成功`);
      } catch (error) {
        console.error(`\n❌ ${pkg.name} 发布失败`);
        console.error('正在恢复 package.json...');
        await execCommand('node', ['scripts/post-build.js', 'restore'], {
          cwd: path.join(__dirname, '..')
        });
        process.exit(1);
      }
    }
  } else {
    console.log('\n⚠️  Dry-run 模式，跳过实际发布');
  }

  // 5. 恢复 package.json
  console.log('\n恢复 package.json...\n');
  await execCommand('node', ['scripts/post-build.js', 'restore'], {
    cwd: path.join(__dirname, '..')
  });

  console.log('\n========================================');
  console.log('✅ 完成！');
  console.log('========================================\n');
}

main().catch(error => {
  console.error('\n❌ 发生错误:', error.message);

  // 尝试恢复 package.json
  console.log('\n正在恢复 package.json...');
  execCommand('node', ['scripts/post-build.js', 'restore'], {
    cwd: path.join(__dirname, '..')
  }).catch(() => {});

  process.exit(1);
});
