#!/usr/bin/env node
/**
 * 在本机构建 food_link Go 后端 Docker 镜像并推送到腾讯云 CCR。
 *
 * 镜像路径固定为：ccr.ccs.tencentyun.com/littlehorse/foodlink。
 * 当前 Go 后端迁移阶段统一推送标签：v2。
 *
 * 用法（在仓库根目录）：
 *   npm run push-docker-ccr
 *
 * 构建上下文为 backend/（含 backend/Dockerfile）。
 * 默认强制构建 linux/amd64，避免 ARM 开发机推送后在 AMD64 服务器不可运行。
 * 如需覆盖平台，可传入环境变量 DOCKER_BUILD_PLATFORM（例如 linux/amd64,linux/arm64）。
 *
 * 运行时配置由部署侧环境变量 / ConfigMap 注入，勿把密钥打进镜像。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');

const REGISTRY = 'ccr.ccs.tencentyun.com';
const IMAGE_NAMESPACE = 'littlehorse';
const IMAGE_REPOSITORY = 'foodlink';
const IMAGE_TAG = 'v2';

function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const GIT_ROOT = findGitRoot(BACKEND_ROOT);

function print(...args) {
  console.log(...args);
}

function die(msg, hint) {
  console.error(`\n错误: ${msg}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd ?? BACKEND_ROOT,
    encoding: 'utf-8',
    stdio: opts.inherit === false ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
    env: { ...process.env, ...opts.env },
  });

  if (result.status !== 0) {
    return {
      ok: false,
      code: result.status,
      signal: result.signal,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
    };
  }

  return {
    ok: true,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function hasDocker() {
  const result = run('docker', ['version'], { inherit: false });
  if (!result.ok) {
    return {
      ok: false,
      hint:
        '未检测到可用的 Docker。\n' +
        '  Windows / macOS：请安装并启动 Docker Desktop（托盘图标就绪后再试）。\n' +
        '  Linux：请安装 Docker Engine，并确保当前用户有权限访问 Docker daemon。\n' +
        '安装后在本终端执行 `docker version` 应能同时看到 Client 与 Server。',
    };
  }
  return { ok: true };
}

function hasBuildx() {
  const result = run('docker', ['buildx', 'version'], { inherit: false });
  if (!result.ok) {
    return {
      ok: false,
      hint:
        '未检测到可用的 Docker Buildx。\n' +
        '请先确认 Docker Desktop 已启用 Buildx（或升级 Docker 版本），然后执行 `docker buildx version` 验证。',
    };
  }
  return { ok: true };
}

function git(args) {
  return run('git', args, { inherit: false, cwd: GIT_ROOT ?? BACKEND_ROOT });
}

function main() {
  print('=== food_link：本地构建 Go 后端镜像并推送腾讯云 CCR ===\n');

  const dockerCheck = hasDocker();
  if (!dockerCheck.ok) die('无法执行 docker', dockerCheck.hint);

  const buildxCheck = hasBuildx();
  if (!buildxCheck.ok) die('无法执行 docker buildx', buildxCheck.hint);

  if (!GIT_ROOT) {
    die(
      '未找到 Git 仓库（自 backend/ 向上未见到 .git）',
      '请在 food_link 克隆目录内执行：npm run push-docker-ccr',
    );
  }

  const branchResult = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const shaResult = git(['rev-parse', '--short=7', 'HEAD']);
  const branch = branchResult.ok ? branchResult.stdout : 'unknown';
  const shortSha = shaResult.ok ? shaResult.stdout : 'unknown';

  const imageBase = `${REGISTRY}/${IMAGE_NAMESPACE}/${IMAGE_REPOSITORY}`;
  const imageTag = `${imageBase}:${IMAGE_TAG}`;
  const buildPlatform = (process.env.DOCKER_BUILD_PLATFORM || 'linux/amd64').trim() || 'linux/amd64';
  const buildProgress = (process.env.DOCKER_BUILD_PROGRESS || 'auto').trim() || 'auto';

  print(`Registry:   ${REGISTRY}`);
  print(`镜像基名:   ${imageBase}`);
  print(`镜像标签:   ${IMAGE_TAG}`);
  print(`当前分支:   ${branch}`);
  print(`Git 短 SHA: ${shortSha}`);
  print(`构建平台:   ${buildPlatform}`);
  if (buildProgress !== 'auto') {
    print(`进度模式:   ${buildProgress}`);
  }
  print(`将推送:     ${imageTag}\n`);

  print('--- 登录（推送前须已登录腾讯云 CCR）---');
  print('若尚未登录，请先在本机执行：');
  print(`  docker login ${REGISTRY}`);
  print('然后再运行本脚本。\n');

  const buildArgs = ['buildx', 'build', '--platform', buildPlatform];
  if (buildProgress !== 'auto') {
    buildArgs.push('--progress', buildProgress);
  }
  buildArgs.push('-t', imageTag, '--push', '.');

  print('--- docker buildx build --push ---');
  const build = run('docker', buildArgs, { inherit: true });
  if (!build.ok) {
    const tip =
      '常见原因：未登录腾讯云 CCR、账号或密码错误、Docker daemon 未启动、网络问题。\n' +
      `请先执行: docker login ${REGISTRY}\n` +
      '\n' +
      '若上方 docker 原始报错信息不够，可打开完整构建输出：\n' +
      '  PowerShell: $env:DOCKER_BUILD_PROGRESS="plain"; npm run push-docker-ccr\n' +
      '  Bash:       DOCKER_BUILD_PROGRESS=plain npm run push-docker-ccr\n' +
      '\n' +
      '也可以单独调试构建（不推送）：\n' +
      `  docker buildx build --platform ${buildPlatform} --progress plain -t ${imageTag} ${BACKEND_ROOT}`;
    die('docker buildx build --push 失败', tip);
  }

  print('\n全部构建并推送完成。');
  print(`示例拉取: docker pull ${imageTag}`);
}

main();
