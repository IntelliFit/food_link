#!/usr/bin/env ts-node
/**
 * Trace test runner — aggregate entrypoint.
 *
 * Reads trace files, executes all traces against a shared temporary database,
 * and outputs a pass/fail report.
 *
 * Usage:
 *   npx ts-node src/trace-runner.ts --traces traces/analyze-food.yaml
 *   npx ts-node src/trace-runner.ts --traces 'traces/*.yaml'
 */
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import yaml from 'js-yaml';
import { Command } from 'commander';
import { globSync } from 'glob';
import { BackendClient } from './backend-client';
import type { TraceFile, Trace, TraceResult, TraceReport } from './types';
import { executeTrace } from './trace-engine';
import {
  PROJECT_ROOT,
  findFreePort,
  startBackendServer,
  buildMiniprogram,
  startDevTools,
  ensureScreenshotDirs,
  resolveBackendVariables,
  sleep,
} from './infra';

const program = new Command();

program
  .option('-t, --traces <pattern>', 'Path or glob pattern to trace YAML file(s)', 'traces/*.yaml')
  .option('-s, --suite <path>', 'Suite YAML path', 'backend/e2e-test/suite.yaml')
  .option('-p, --port <number>', 'Backend HTTP port (0 = auto)', '0')
  .option('-d, --devtools-port <number>', 'WeChat DevTools auto port', '9420')
  .option('--skip-build', 'Skip building the miniprogram')
  .option('--keep-db', 'Keep temporary database after run')
  .option('--update-baseline', 'Update screenshot baselines from actual captures')
  .parse(process.argv);

const opts = program.opts();

let BACKEND_PORT = parseInt(opts.port, 10);
const DEVTOOLS_PORT = parseInt(opts.devtoolsPort, 10);
const TRACES_PATTERN = opts.traces;
const SUITE_PATH = resolve(PROJECT_ROOT, opts.suite);
const KEEP_DB = opts.keepDb || false;
const SKIP_BUILD = opts.skipBuild || false;
const UPDATE_BASELINE = opts.updateBaseline || false;

async function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  Trace 测试聚合运行器');
  console.log('══════════════════════════════════════════════════');

  // 1. Resolve trace files
  const traceFiles = resolveTraceFiles(TRACES_PATTERN);
  if (traceFiles.length === 0) {
    console.error(`❌ No trace files found matching: ${TRACES_PATTERN}`);
    process.exit(2);
  }

  const allTraces: Trace[] = [];
  for (const file of traceFiles) {
    const tf = loadTraceFile(file);
    allTraces.push(...tf.traces);
  }

  console.log(`Trace files: ${traceFiles.length}`);
  console.log(`Total traces: ${allTraces.length}`);
  console.log('');

  // 2. Auto-assign port
  if (BACKEND_PORT === 0) {
    BACKEND_PORT = await findFreePort(3020);
  }
  console.log(`Backend:  http://127.0.0.1:${BACKEND_PORT}`);
  console.log(`DevTools: port ${DEVTOOLS_PORT}`);
  console.log('');

  // 3. Start backend test server
  let backendProc: any = null;
  let devtoolsProc: any = null;
  let devtoolsStartedByUs = false;

  try {
    const backendResult = await startBackendServer(SUITE_PATH, BACKEND_PORT, KEEP_DB);
    backendProc = backendResult.proc;
  } catch (err: any) {
    console.error(`❌ Failed to start backend: ${err.message}`);
    process.exit(2);
  }

  const backend = new BackendClient(`http://127.0.0.1:${BACKEND_PORT}`);
  const apiBaseUrl = `http://127.0.0.1:${BACKEND_PORT}`;

  try {
    // 4. Wait for backend ready
    console.log('⏳ Waiting for backend to be ready...');
    await backend.waitForReady(30000, 500);
    console.log('✅ Backend is ready');
    console.log('');

    // 5. Build miniprogram if needed
    if (!SKIP_BUILD) {
      console.log('🔨 Building miniprogram...');
      await buildMiniprogram('development', apiBaseUrl);
      console.log('✅ Build complete');
      console.log('');
    }

    // 6. Start WeChat DevTools
    const devtoolsResult = await startDevTools(DEVTOOLS_PORT);
    devtoolsProc = devtoolsResult.proc;
    devtoolsStartedByUs = devtoolsResult.startedByUs;
    console.log('');

    // 7. Ensure screenshot dirs
    ensureScreenshotDirs();

    // 8. Fetch backend variables and tokens
    console.log('🔑 Fetching test tokens...');
    const vars = await resolveBackendVariables(backend);
    console.log(`✅ Variables resolved (${Object.keys(vars).length} vars)`);
    console.log('');

    // 9. Execute all traces
    const report = await executeAllTraces(allTraces, vars, backend, DEVTOOLS_PORT);

    // 10. Print report
    printReport(report);

    // Exit with appropriate code
    process.exit(report.failedTraces > 0 ? 1 : 0);
  } finally {
    // Cleanup
    console.log('');
    console.log('🧹 Cleaning up...');

    if (devtoolsStartedByUs && devtoolsProc && !devtoolsProc.killed) {
      console.log('   Stopping WeChat DevTools...');
      devtoolsProc.kill('SIGTERM');
      await sleep(1000);
      if (!devtoolsProc.killed) {
        devtoolsProc.kill('SIGKILL');
      }
    }

    if (backendProc && !backendProc.killed) {
      backendProc.kill('SIGTERM');
      await sleep(2000);
      if (!backendProc.killed) {
        backendProc.kill('SIGKILL');
      }
    }
    console.log('✅ Cleanup complete');
  }
}

function resolveTraceFiles(pattern: string): string[] {
  const resolvedPattern = resolve(PROJECT_ROOT, 'e2e-weapp', pattern);
  if (existsSync(resolvedPattern)) {
    // Single file
    return [resolvedPattern];
  }
  // Try glob
  const files = globSync(resolvedPattern);
  return files;
}

function loadTraceFile(path: string): TraceFile {
  if (!existsSync(path)) {
    throw new Error(`Trace file not found: ${path}`);
  }
  const content = readFileSync(path, 'utf-8');
  return yaml.load(content) as TraceFile;
}

async function executeAllTraces(
  traces: Trace[],
  vars: Record<string, string>,
  backend: BackendClient,
  devtoolsPort: number
): Promise<TraceReport> {
  const results: TraceResult[] = [];
  const startTime = Date.now();

  console.log('══════════════════════════════════════════════════');
  console.log('  Executing Traces');
  console.log('══════════════════════════════════════════════════');

  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    console.log(`\n▶ [${i + 1}/${traces.length}] ${trace.id}`);

    // Reset database before each trace for isolation
    try {
      await backend.resetDb();
      console.log('   🔄 Database reset');
    } catch (err: any) {
      console.warn(`   ⚠️  DB reset failed: ${err.message}`);
    }

    const traceStart = Date.now();
    const engineResult = await executeTrace(trace, vars, backend, devtoolsPort, UPDATE_BASELINE);
    const durationMs = Date.now() - traceStart;

    const traceResult: TraceResult = {
      traceId: trace.id,
      traceName: trace.name,
      success: engineResult.success,
      durationMs,
      steps: engineResult.steps,
      failedStepIndex: engineResult.failedStepIndex,
      failedStepMessage: engineResult.failedStepMessage,
    };

    results.push(traceResult);

    const icon = traceResult.success ? '✅' : '❌';
    console.log(`   ${icon} ${traceResult.traceName} — ${durationMs}ms`);
    if (!traceResult.success && traceResult.failedStepMessage) {
      console.log(`      → ${traceResult.failedStepMessage}`);
    }
  }

  const passedTraces = results.filter((r) => r.success).length;
  const failedTraces = results.length - passedTraces;

  return {
    totalTraces: traces.length,
    passedTraces,
    failedTraces,
    durationMs: Date.now() - startTime,
    traces: results,
  };
}

function printReport(report: TraceReport) {
  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  Trace Test Report');
  console.log('══════════════════════════════════════════════════');
  console.log(`Total:   ${report.totalTraces} traces`);
  console.log(`Passed:  ${report.passedTraces}`);
  console.log(`Failed:  ${report.failedTraces}`);
  console.log(`Time:    ${report.durationMs}ms`);
  console.log('');

  for (let i = 0; i < report.traces.length; i++) {
    const t = report.traces[i];
    const icon = t.success ? '✅' : '❌';
    console.log(`  ${icon} [${i + 1}/${report.totalTraces}] ${t.traceName} (${t.traceId}) — ${t.durationMs}ms`);
    if (!t.success && t.failedStepMessage) {
      console.log(`      → Step ${t.failedStepIndex}: ${t.failedStepMessage}`);
    }
  }

  console.log('');
  if (report.failedTraces === 0) {
    console.log('🎉 All traces passed!');
  } else {
    console.log(`⚠️  ${report.failedTraces} trace(s) failed.`);
  }
  console.log('══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
