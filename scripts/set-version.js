#!/usr/bin/env node
/**
 * 统一设置所有包的版本号
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packages = [
  { name: 'root', dir: path.join(__dirname, '..'), displayName: chalk.gray('root') },
  { name: '@feng3d/chuantou-shared', dir: path.join(__dirname, '..', 'packages', 'shared'), displayName: chalk.cyan('@feng3d/chuantou-shared') },
  { name: '@feng3d/cts', dir: path.join(__dirname, '..', 'packages', 'server'), displayName: chalk.blue('@feng3d/cts') },
  { name: '@feng3d/chuantou-client', dir: path.join(__dirname, '..', 'packages', 'client'), displayName: chalk.green('@feng3d/chuantou-client') },
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
 * 设置包的版本号，同时更新依赖的 shared 包版本
 */
function setPackageVersion(pkgDir, version) {
  const pkgPath = path.join(pkgDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;

  // 如果包依赖了 @feng3d/chuantou-shared，也更新其版本
  if (pkg.dependencies && pkg.dependencies['@feng3d/chuantou-shared']) {
    pkg.dependencies['@feng3d/chuantou-shared'] = `^${version}`;
  }

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

const program = new Command();

program
  .name('set-version')
  .description('统一设置所有包的版本号')
  .argument('[version|type]', '版本号 (如 1.0.0) 或升级类型 (major/minor/patch)', 'patch')
  .option('-d, --dry-run', '预览模式，不实际修改')
  .action((input, options) => {
    const currentVersion = getPackageVersion(packages[0].dir);
    let newVersion;
    let isBump = false;

    if (['major', 'minor', 'patch'].includes(input)) {
      isBump = true;
      newVersion = bumpVersion(currentVersion, input);
    } else {
      newVersion = input;
    }

    if (options.dryRun) {
      console.log(chalk.yellow.bold('\n🔍 预览模式\n'));
    } else {
      console.log(chalk.cyan.bold('\n⚡ Chuantou 版本管理\n'));
    }

    // 显示当前版本
    console.log(`${chalk.gray('当前版本:')} ${chalk.white.bold(currentVersion)}`);

    // 显示变更
    if (isBump) {
      const typeColor = input === 'major' ? 'red' : input === 'minor' ? 'yellow' : 'green';
      console.log(`${chalk.gray('升级类型:')} ${chalk[typeColor](input)}`);
    }
    console.log(`${chalk.gray('新版本:')} ${chalk.white.bold(newVersion)}`);
    console.log();

    // 显示将要更新的包
    console.log(chalk.gray('将更新以下包:'));

    if (!options.dryRun) {
      packages.forEach(pkg => {
        setPackageVersion(pkg.dir, newVersion);
        console.log(`  ${chalk.green('✓')} ${pkg.displayName} ${chalk.gray(`→ ${newVersion}`)}`);
      });
      console.log();
      console.log(chalk.green.bold('✅ 所有包版本号已更新!'));
    } else {
      packages.forEach(pkg => {
        console.log(`  ${chalk.yellow('○')} ${pkg.displayName} ${chalk.gray(`→ ${newVersion}`)}`);
      });
      console.log();
      console.log(chalk.yellow.bold('⚠️  预览模式，未实际修改'));
    }
    console.log();
  });

program.parse();
