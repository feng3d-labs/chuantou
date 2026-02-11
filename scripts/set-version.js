#!/usr/bin/env node
/**
 * 统一设置所有包的版本号
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packages = [
  { name: 'root', dir: path.join(__dirname, '..'), displayName: chalk.gray('root') },
  { name: '@feng3d/chuantou-shared', dir: path.join(__dirname, '..', 'packages', 'shared'), displayName: chalk.cyan('@feng3d/chuantou-shared') },
  { name: '@feng3d/cts', dir: path.join(__dirname, '..', 'packages', 'server'), displayName: chalk.blue('@feng3d/cts') },
  { name: '@feng3d/ctc', dir: path.join(__dirname, '..', 'packages', 'client'), displayName: chalk.green('@feng3d/ctc') },
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

/**
 * 执行命令并显示输出
 */
function runCommand(command, cwd) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: 'utf-8',
      stdio: 'inherit'
    });
    return { success: true, output };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const program = new Command();

program
  .name('set-version')
  .description('统一设置所有包的版本号')
  .argument('[version|type]', '版本号 (如 1.0.0) 或升级类型 (major/minor/patch)', 'patch')
  .option('-d, --dry-run', '预览模式，不实际修改')
  .option('--no-install', '更新版本后跳过 npm install')
  .option('-c, --commit', '更新版本后自动提交到 git')
  .option('-p, --push', '更新版本后自动推送到远程')
  .action(async (input, options) => {
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

      // 运行 npm install（默认执行，除非 --no-install）
      if (options.install !== false) {
        console.log();
        console.log(chalk.gray('运行 npm install 更新依赖...'));
        const rootDir = path.join(__dirname, '..');
        const result = runCommand('npm install', rootDir);
        if (result.success) {
          console.log(chalk.green('✓') + ' 依赖已更新');
        } else {
          console.log(chalk.red('✗') + '  npm install 失败');
          console.log(chalk.gray(result.error));
          process.exit(1);
        }
      }

      // 提交到 git
      if (options.commit) {
        console.log();
        console.log(chalk.gray('提交到 git...'));
        const rootDir = path.join(__dirname, '..');

        runCommand('git add -A', rootDir);
        const commitMsg = isBump
          ? `chore: 升级版本至 v${newVersion}`
          : `chore: 设置版本为 v${newVersion}`;
        runCommand(`git commit -m "${commitMsg}"`, rootDir);
        console.log(chalk.green('✓') + '  已提交');
      }

      // 推送到远程
      if (options.push) {
        console.log();
        console.log(chalk.gray('推送到远程...'));
        const rootDir = path.join(__dirname, '..');
        const result = runCommand('git push', rootDir);
        if (result.success) {
          console.log(chalk.green('✓') + '  已推送');
        } else {
          console.log(chalk.red('✗') + '  推送失败');
          console.log(chalk.gray(result.error));
        }
      }

      console.log();
      if (options.install !== false && options.commit) {
        console.log(chalk.green.bold('✅ 完成! 工作流将被触发'));
      }
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
