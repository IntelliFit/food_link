/**
 * Shared infrastructure for e2e-weapp test runners.
 * Extracted from runner.ts so both scenario runner and trace runner can reuse.
 */
import execa = require('execa');
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { BackendClient } from './backend-client';

export const PROJECT_ROOT = resolve(__dirname, '../..');
export const BACKEND_DIR = resolve(PROJECT_ROOT, 'backend');
export const WECHAT_APP_DIR = resolve(PROJECT_ROOT, 'apps/wechat');
export const DIST_DIR = resolve(WECHAT_APP_DIR, 'dist');

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function findFreePort(startPort: number): Promise<number> {
  const net = await import('net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? (addr as any).port : startPort;
      server.close(() => resolve(port));
    });
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(findFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

export async function startBackendServer(
  suitePath: string,
  port: number,
  keepDB: boolean = false
): Promise<{ proc: any }> {
  const args = [
    'run',
    './e2e-test/cmd/api-test-server',
    '--suite',
    suitePath,
    '--config-dir',
    '.',
    '--port',
    String(port),
  ];
  if (keepDB) {
    args.push('--keep-db');
  }

  console.log(`🚀 Starting backend test server...`);
  console.log(`   go ${args.join(' ')}`);

  const proc = execa('go', args, {
    cwd: BACKEND_DIR,
    detached: false,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      console.log(`   [backend] ${line}`);
    }
  });
  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      console.error(`   [backend] ${line}`);
    }
  });

  proc.on('exit', (code: number | null) => {
    if (code !== null && code !== 0 && code !== 143) {
      console.error(`   [backend] Exited with code ${code}`);
    }
  });

  await sleep(2000);
  if (proc.exitCode !== null && proc.exitCode !== 0) {
    throw new Error(`Backend exited with code ${proc.exitCode}`);
  }

  return { proc };
}

export async function buildMiniprogram(mode: string, apiBaseUrl: string): Promise<void> {
  const script = 'build:weapp:e2e';
  const env = {
    ...process.env,
    TARO_APP_API_BASE_URL_OVERRIDE: apiBaseUrl,
  };

  console.log(`   Build script: ${script}`);
  console.log(`   API Base URL: ${apiBaseUrl}`);

  const proc = execa('npm', ['run', script], {
    cwd: PROJECT_ROOT,
    env,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(data);
  });
  proc.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(data);
  });

  const { exitCode } = await proc;
  if (exitCode !== 0) {
    throw new Error(`Miniprogram build failed with exit code ${exitCode}`);
  }
}

export async function checkDevToolsRunning(port: number): Promise<boolean> {
  try {
    const { stdout } = await execa('lsof', ['-i', `:${port}`], { reject: false });
    return stdout.includes('LISTEN');
  } catch {
    return false;
  }
}

export async function waitForMrcReady(
  port: number,
  timeoutMs: number = 60000,
  intervalMs: number = 1000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout } = await execa('mrc', ['where', '--port', String(port)], {
        timeout: 5000,
        reject: false,
      });
      if (stdout.includes('✅') || stdout.includes('连接成功')) {
        return;
      }
    } catch {
      // ignore
    }
    await sleep(intervalMs);
  }
  throw new Error(`DevTools mrc not ready after ${timeoutMs}ms`);
}

export async function startDevTools(
  port: number
): Promise<{ proc: any; startedByUs: boolean }> {
  const isRunning = await checkDevToolsRunning(port);
  if (isRunning) {
    console.log('🔧 WeChat DevTools already running');
    return { proc: null, startedByUs: false };
  }

  const cliPath = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
  console.log('🔧 Starting WeChat DevTools...');

  const proc = execa(cliPath, ['auto', '--project', WECHAT_APP_DIR, '--auto-port', String(port)], {
    detached: false,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      console.log(`   [devtools] ${line}`);
    }
  });
  proc.stderr?.on('data', (data: Buffer) => {
    const line = data.toString().trim();
    if (line) {
      console.error(`   [devtools] ${line}`);
    }
  });

  console.log('⏳ Waiting for DevTools mrc connection...');
  await waitForMrcReady(port, 60000, 1000);
  console.log('✅ DevTools ready');

  return { proc, startedByUs: true };
}

export function ensureScreenshotDirs() {
  const dirs = [
    resolve(PROJECT_ROOT, 'e2e-weapp/screenshots/actual'),
    resolve(PROJECT_ROOT, 'e2e-weapp/screenshots/baseline'),
    resolve(PROJECT_ROOT, 'e2e-weapp/screenshots/diff'),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export async function resolveBackendVariables(
  backend: BackendClient,
  knownUsers: string[] = ['user1', 'user2']
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  try {
    const suiteVars = await backend.getSuiteVars();
    for (const [k, v] of Object.entries(suiteVars)) {
      vars[`backend.${k}`] = v;
    }
  } catch (err: any) {
    console.warn(`   Warning: Could not fetch suite vars: ${err.message}`);
  }

  for (const user of knownUsers) {
    try {
      const tokenRes = await backend.getToken(user);
      vars[`backend.token.${user}`] = tokenRes.token;
      vars[`backend.auth.${user}.id`] = tokenRes.user_id;
      vars[`backend.auth.${user}.openid`] = tokenRes.openid;
      vars[`backend.auth.${user}.unionid`] = tokenRes.unionid;
    } catch {
      // User may not exist in suite, that's okay
    }
  }

  return vars;
}
