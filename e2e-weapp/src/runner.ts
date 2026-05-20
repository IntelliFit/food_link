#!/usr/bin/env ts-node
import execa = require('execa');
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import yaml from 'js-yaml';
import { Command } from 'commander';
import {
  mrcScreenshot,
  mrcExists,
  mrcTap,
  mrcEvaluate,
  mrcRelaunch,
  mrcSwitchTab,
  mrcBack,
  mrcWait,
  mrcClearMocks,
} from './mrc';
import { BackendClient } from './backend-client';
import type { Scenario, Step, StepResult, ScenarioResult, StepAssert } from './types';

const program = new Command();

program
  .option('-s, --scenario <path>', 'Path to scenario YAML file', 'scenarios/home-dashboard.yaml')
  .option('-p, --port <number>', 'Backend HTTP port (0 = auto)', '0')
  .option('-d, --devtools-port <number>', 'WeChat DevTools auto port', '9420')
  .option('--skip-build', 'Skip building the miniprogram')
  .option('--keep-db', 'Keep temporary database after run')
  .option('--update-baseline', 'Update screenshot baselines')
  .parse(process.argv);

const opts = program.opts();

let BACKEND_PORT = parseInt(opts.port, 10);
const DEVTOOLS_PORT = parseInt(opts.devtoolsPort, 10);
const SCENARIO_PATH = resolve(opts.scenario);
const KEEP_DB = opts.keepDb || false;
const SKIP_BUILD = opts.skipBuild || false;
const UPDATE_BASELINE = opts.updateBaseline || false;

const PROJECT_ROOT = resolve(__dirname, '../..');
const BACKEND_DIR = resolve(PROJECT_ROOT, 'backend');
const DIST_DIR = resolve(PROJECT_ROOT, 'dist');

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  微信小程序端到端自动化测试运行器');
  console.log('══════════════════════════════════════════════════');
  console.log(`Scenario: ${SCENARIO_PATH}`);

  // Auto-assign port if not specified
  if (BACKEND_PORT === 0) {
    BACKEND_PORT = await findFreePort(3020);
  }

  console.log(`Backend:  http://127.0.0.1:${BACKEND_PORT}`);
  console.log(`DevTools: port ${DEVTOOLS_PORT}`);
  console.log('');

  // 1. Load scenario
  const scenario = loadScenario(SCENARIO_PATH);
  console.log(`✅ Loaded scenario: ${scenario.name} (${scenario.id})`);
  console.log(`   Steps: ${scenario.steps.length}`);
  console.log('');

  // 2. Start backend test server
  let backendProc: any = null;
  try {
    backendProc = await startBackendServer(scenario, BACKEND_PORT);
  } catch (err: any) {
    console.error(`❌ Failed to start backend: ${err.message}`);
    process.exit(1);
  }

  const backend = new BackendClient(`http://127.0.0.1:${BACKEND_PORT}`);
  const apiBaseUrl = `http://127.0.0.1:${BACKEND_PORT}`;

  try {
    // 3. Wait for backend ready
    console.log('⏳ Waiting for backend to be ready...');
    await backend.waitForReady(30000, 500);
    console.log('✅ Backend is ready');
    console.log('');

    // 4. Build miniprogram if needed
    if (!SKIP_BUILD) {
      console.log('🔨 Building miniprogram...');
      await buildMiniprogram(scenario.setup.miniprogram.build_mode, apiBaseUrl);
      console.log('✅ Build complete');
      console.log('');
    }

    // 5. Ensure screenshots dirs exist
    ensureDirs();

    // 6. Fetch backend variables and tokens
    console.log('🔑 Fetching test tokens...');
    const vars = await resolveVariables(backend, scenario);
    console.log(`✅ Variables resolved (${Object.keys(vars).length} vars)`);
    console.log('');

    // 7. Execute scenario
    const result = await executeScenario(scenario, vars, backend, DEVTOOLS_PORT);

    // 8. Print results
    printResults(result);

    // Exit with appropriate code
    process.exit(result.failedSteps > 0 ? 1 : 0);
  } finally {
    // Cleanup
    console.log('');
    console.log('🧹 Cleaning up...');
    if (backendProc && !backendProc.killed) {
      backendProc.kill('SIGTERM');
      // Give it a moment to drop the DB
      await sleep(2000);
      if (!backendProc.killed) {
        backendProc.kill('SIGKILL');
      }
    }
    console.log('✅ Cleanup complete');
  }
}

function loadScenario(path: string): Scenario {
  if (!existsSync(path)) {
    throw new Error(`Scenario file not found: ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  return yaml.load(content) as Scenario;
}

async function startBackendServer(scenario: Scenario, port: number): Promise<any> {
  const suitePath = resolve(PROJECT_ROOT, scenario.setup.backend.suite);

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
  if (KEEP_DB) {
    args.push('--keep-db');
  }

  console.log(`🚀 Starting backend test server...`);
  console.log(`   go ${args.join(' ')}`);

  const proc = execa('go', args, {
    cwd: BACKEND_DIR,
    detached: false,
  });

  // Stream backend logs
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

  return proc;
}

async function buildMiniprogram(mode: string, apiBaseUrl: string): Promise<void> {
  const script = 'build:weapp:e2e';
  const env = {
    ...process.env,
    TARO_APP_API_BASE_URL: apiBaseUrl,
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

function ensureDirs() {
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

async function resolveVariables(backend: BackendClient, scenario: Scenario): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  // Fetch suite vars from backend
  try {
    const suiteVars = await backend.getSuiteVars();
    for (const [k, v] of Object.entries(suiteVars)) {
      vars[`backend.${k}`] = v;
    }
  } catch (err: any) {
    console.warn(`   Warning: Could not fetch suite vars: ${err.message}`);
  }

  // Fetch tokens for known users
  const knownUsers = ['user1', 'user2'];
  for (const user of knownUsers) {
    try {
      const tokenRes = await backend.getToken(user);
      vars[`backend.token.${user}`] = tokenRes.token;
      vars[`backend.auth.${user}.id`] = tokenRes.user_id;
      vars[`backend.auth.${user}.openid`] = tokenRes.openid;
      vars[`backend.auth.${user}.unionid`] = tokenRes.unionid;
    } catch (err: any) {
      // User may not exist in suite, that's okay
    }
  }

  return vars;
}

async function executeScenario(
  scenario: Scenario,
  vars: Record<string, string>,
  backend: BackendClient,
  devtoolsPort: number
): Promise<ScenarioResult> {
  const results: StepResult[] = [];
  const captures: Record<string, string> = {};
  const startTime = Date.now();

  console.log('══════════════════════════════════════════════════');
  console.log('  Executing Scenario Steps');
  console.log('══════════════════════════════════════════════════');

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const stepStart = Date.now();
    const stepName = step.name || `${step.action}`;

    console.log(`\n[${i + 1}/${scenario.steps.length}] ${stepName} (${step.action})`);

    let success = true;
    let message: string | undefined;
    let screenshotPath: string | undefined;

    try {
      // Replace variables in the step
      const resolvedStep = resolveStepVars(step, { ...vars, ...captures });

      // Execute the action
      const actionResult = await executeStepAction(resolvedStep, devtoolsPort, backend);
      screenshotPath = actionResult.screenshotPath;

      // Handle inline assert
      if (resolvedStep.assert) {
        const assertResult = await executeAssert(resolvedStep.assert, devtoolsPort, backend, { ...vars, ...captures });
        if (!assertResult.success) {
          success = false;
          message = `Assert failed: ${assertResult.message}`;
        }
      }

      // Handle capture
      if (resolvedStep.capture && actionResult.captureData) {
        for (const [key, path] of Object.entries(resolvedStep.capture)) {
          captures[key] = getValueAtPath(actionResult.captureData, path) || '';
          console.log(`   📸 Captured ${key} = ${captures[key]}`);
        }
      }
    } catch (err: any) {
      success = false;
      message = err.message || String(err);
    }

    const durationMs = Date.now() - stepStart;
    results.push({
      stepIndex: i + 1,
      action: step.action,
      name: stepName,
      success,
      durationMs,
      message,
      screenshotPath,
    });

    const icon = success ? '✅' : '❌';
    console.log(`   ${icon} ${durationMs}ms${message ? ` | ${message}` : ''}`);

    if (!success) {
      // Continue to next step unless it's a fatal error
      // In MVP, we continue to get full results
    }
  }

  const totalSteps = results.length;
  const passedSteps = results.filter((r) => r.success).length;
  const failedSteps = totalSteps - passedSteps;

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    totalSteps,
    passedSteps,
    failedSteps,
    durationMs: Date.now() - startTime,
    steps: results,
  };
}

interface ActionResult {
  screenshotPath?: string;
  captureData?: any;
}

async function executeStepAction(
  step: Step,
  port: number,
  backend: BackendClient
): Promise<ActionResult> {
  const result: ActionResult = {};

  switch (step.action) {
    case 'evaluate': {
      if (!step.script) throw new Error('evaluate requires script');
      const res = await mrcEvaluate(step.script, port);
      if (!res.success) throw new Error(res.error || 'evaluate failed');
      result.captureData = res.data;
      break;
    }

    case 'relaunch': {
      if (!step.url) throw new Error('relaunch requires url');
      const res = await mrcRelaunch(step.url, port);
      if (!res.success) throw new Error(res.error || 'relaunch failed');
      break;
    }

    case 'switchTab': {
      if (!step.url) throw new Error('switchTab requires url');
      const res = await mrcSwitchTab(step.url, port);
      if (!res.success) throw new Error(res.error || 'switchTab failed');
      break;
    }

    case 'back': {
      const res = await mrcBack(port);
      if (!res.success) throw new Error(res.error || 'back failed');
      break;
    }

    case 'tap':
    case 'click': {
      if (!step.selector) throw new Error('tap requires selector');
      const res = await mrcTap(step.selector, port);
      if (!res.success) throw new Error(res.error || 'tap failed');
      break;
    }

    case 'wait': {
      if (step.ms === undefined) throw new Error('wait requires ms');
      const res = await mrcWait(step.ms, port);
      if (!res.success) throw new Error(res.error || 'wait failed');
      break;
    }

    case 'screenshot': {
      if (!step.path) throw new Error('screenshot requires path');
      const fullPath = resolve(PROJECT_ROOT, step.path);
      // Ensure parent dir exists
      const parentDir = dirname(fullPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      const res = await mrcScreenshot(fullPath, port);
      if (!res.success) throw new Error(res.error || 'screenshot failed');
      result.screenshotPath = fullPath;
      console.log(`   📸 Screenshot saved: ${fullPath}`);
      break;
    }

    case 'assert_element':
    case 'assert_evaluate':
    case 'db_assert': {
      // These are pure assertions, handled by executeAssert
      break;
    }

    case 'clearMocks': {
      const res = await mrcClearMocks(port);
      if (!res.success) throw new Error(res.error || 'clearMocks failed');
      break;
    }

    default:
      throw new Error(`Unknown action: ${step.action}`);
  }

  return result;
}

async function executeAssert(
  assert: StepAssert,
  port: number,
  backend: BackendClient,
  vars: Record<string, string>
): Promise<{ success: boolean; message?: string }> {
  switch (assert.type) {
    case 'element_exists': {
      if (!assert.selector) return { success: false, message: 'selector required' };
      const res = await mrcExists(assert.selector, port);
      if (!res.success) return { success: false, message: res.error };
      const exists = res.data?.exists ?? false;
      const expected = assert.exists !== false; // default true
      if (exists !== expected) {
        return {
          success: false,
          message: `Expected element ${assert.selector} exists=${expected}, got ${exists}`,
        };
      }
      return { success: true };
    }

    case 'evaluate_equals': {
      if (!assert.script) return { success: false, message: 'script required' };
      const resolvedScript = replaceVars(assert.script, vars);
      const res = await mrcEvaluate(resolvedScript, port);
      if (!res.success) return { success: false, message: res.error };
      const actual = res.data;
      // Simple equality check
      if (JSON.stringify(actual) !== JSON.stringify(assert.expected)) {
        return {
          success: false,
          message: `Expected ${JSON.stringify(assert.expected)}, got ${JSON.stringify(actual)}`,
        };
      }
      return { success: true };
    }

    case 'db_assert': {
      if (!assert.query) return { success: false, message: 'query required' };
      const resolvedQuery = replaceVars(assert.query, vars);
      const resolvedArgs = (assert.args || []).map((arg: any) =>
        typeof arg === 'string' ? replaceVars(arg, vars) : arg
      );
      try {
        const data = await backend.queryDb(resolvedQuery, resolvedArgs);
        const count = data.count || 0;
        if (count === 0 && assert.expected !== 0) {
          return { success: false, message: 'Query returned no rows' };
        }
        if (assert.expected !== undefined) {
          const firstRow = data.rows?.[0];
          const firstValue = firstRow ? Object.values(firstRow)[0] : null;
          if (JSON.stringify(firstValue) !== JSON.stringify(assert.expected)) {
            return {
              success: false,
              message: `Expected ${JSON.stringify(assert.expected)}, got ${JSON.stringify(firstValue)}`,
            };
          }
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, message: `DB assert error: ${err.message}` };
      }
    }

    default:
      return { success: false, message: `Unknown assert type: ${assert.type}` };
  }
}

function resolveStepVars(step: Step, vars: Record<string, string>): Step {
  const resolved: Step = { ...step };
  if (resolved.script) resolved.script = replaceVars(resolved.script, vars);
  if (resolved.url) resolved.url = replaceVars(resolved.url, vars);
  if (resolved.selector) resolved.selector = replaceVars(resolved.selector, vars);
  if (resolved.path) resolved.path = replaceVars(resolved.path, vars);
  if (resolved.query) resolved.query = replaceVars(resolved.query, vars);
  if (resolved.args) {
    resolved.args = resolved.args.map((arg) =>
      typeof arg === 'string' ? replaceVars(arg, vars) : arg
    );
  }
  return resolved;
}

function replaceVars(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
    return vars[key] !== undefined ? vars[key] : match;
  });
}

function getValueAtPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

function printResults(result: ScenarioResult) {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  Scenario Results');
  console.log('══════════════════════════════════════════════════');
  console.log(`ID:      ${result.scenarioId}`);
  console.log(`Name:    ${result.scenarioName}`);
  console.log(`Total:   ${result.totalSteps} steps`);
  console.log(`Passed:  ${result.passedSteps}`);
  console.log(`Failed:  ${result.failedSteps}`);
  console.log(`Time:    ${result.durationMs}ms`);
  console.log('');

  for (const step of result.steps) {
    const icon = step.success ? '✅' : '❌';
    console.log(`  ${icon} [${step.stepIndex}] ${step.name} (${step.action}) — ${step.durationMs}ms`);
    if (step.message) {
      console.log(`      → ${step.message}`);
    }
    if (step.screenshotPath) {
      console.log(`      📸 ${step.screenshotPath}`);
    }
  }

  console.log('');
  if (result.failedSteps === 0) {
    console.log('🎉 All steps passed!');
  } else {
    console.log(`⚠️  ${result.failedSteps} step(s) failed.`);
  }
  console.log('══════════════════════════════════════════════════');
}

async function findFreePort(startPort: number): Promise<number> {
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
        // Try next port
        resolve(findFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
