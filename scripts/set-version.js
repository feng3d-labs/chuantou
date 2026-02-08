#!/usr/bin/env node
/**
 * 统一设置所有包的版本号
 *
 * 使用方法：
 *   node scripts/set-version.js 1.0.0        # 设置版本号
 *   node scripts/set-version.js major        # 升级主版本号
 *   node scripts/set-version.js minor        # 升级次版本号
 *   node scripts/set-version.js patch        # 升级补丁版本号
 */

const fs = require('fs');
const path = require('path');

const packages = [
  { name: 'root', dir: path.join(__dirname, '..') },
  { name: '@zhuanfa/shared', dir: path.join(__dirname, '..', 'shared') },
  { name: '@zhuanfa/server', dir: path.join(__dirname, '..', 'server') },
  { name: '@zhuanfa/client', dir: path.join(__dirname, '..', 'client') },
];

/**
 * 获取包的版本号
 */
function getPackageVersion(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * 设置包的版本号
 */
function setPackageVersion(pkgDir, version) {
  const pkgPath = path.join(pkgDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return pkg.name || path.basename(pkgDir);
}

/**
 * 升级版本号
 */
function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      return version;
  }
}

/**
 * 主流程
 */
function main() {
  const input = process.argv[2];

  if (!input) {
    console.log('用法: node scripts/set-version.js <version|major|minor|patch>');
    console.log('  node scripts/set-version.js 1.0.0   # 设置版本号');
    console.log('  node scripts/set-version.js major   # 升级主版本号');
    console.log('  node scripts/set-version.js minor   # 升级次版本号');
    console.log('  node scripts/set-version.js patch   # 升级补丁版本号');
    process.exit(1);
  }

  // 获取当前版本号
  const currentVersion = getPackageVersion(packages[0].dir);
  let newVersion;

  if (['major', 'minor', 'patch'].includes(input)) {
    newVersion = bumpVersion(currentVersion, input);
    console.log(`升级版本号: ${currentVersion} -> ${newVersion} (${input})\n`);
  } else {
    newVersion = input;
    console.log(`设置版本号: ${currentVersion} -> ${newVersion}\n`);
  }

  // 设置所有包的版本号
  console.log('更新以下包的版本号:');
  packages.forEach(pkg => {
    const name = setPackageVersion(pkg.dir, newVersion);
    console.log(`  ✓ ${name}`);
  });

  console.log(`\n✅ 所有包版本号已设置为 ${newVersion}\n`);
}

main();
