/**
 * Trace execution engine.
 * Executes a single trace (sequence of steps) against a running miniprogram + backend.
 */
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
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
  mrcMock,
} from './mrc';
import { BackendClient } from './backend-client';
import type { Trace, Step, StepResult, StepAssert } from './types';
import { PROJECT_ROOT, sleep } from './infra';
import { compareScreenshot, saveAsBaseline } from './screenshot-compare';

export interface EngineResult {
  success: boolean;
  steps: StepResult[];
  failedStepIndex?: number;
  failedStepMessage?: string;
}

export async function executeTrace(
  trace: Trace,
  vars: Record<string, string>,
  backend: BackendClient,
  devtoolsPort: number,
  updateBaseline: boolean = false
): Promise<EngineResult> {
  const results: StepResult[] = [];
  const captures: Record<string, string> = {};
  const startTime = Date.now();

  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`  Trace: ${trace.name} (${trace.id})`);
  console.log(`──────────────────────────────────────────────────`);

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const stepStart = Date.now();
    const stepName = step.name || `${step.action}`;

    console.log(`\n  [${i + 1}/${trace.steps.length}] ${stepName} (${step.action})`);

    let success = true;
    let message: string | undefined;
    let screenshotPath: string | undefined;

    try {
      const resolvedStep = resolveStepVars(step, { ...vars, ...captures });

      // Execute the action
      const actionResult = await executeStepAction(resolvedStep, devtoolsPort, backend, updateBaseline);
      screenshotPath = actionResult.screenshotPath;

      // Handle inline assert (including wait_for's polling assert)
      if (resolvedStep.assert) {
        const assertResult = await executeAssert(resolvedStep.assert, devtoolsPort, backend, {
          ...vars,
          ...captures,
        });
        if (!assertResult.success) {
          success = false;
          message = `Assert failed: ${assertResult.message}`;
        }
      }

      // Handle capture
      if (resolvedStep.capture && actionResult.captureData) {
        for (const [key, path] of Object.entries(resolvedStep.capture)) {
          captures[key] = getValueAtPath(actionResult.captureData, path) || '';
          console.log(`     📸 Captured ${key} = ${captures[key]}`);
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
    console.log(`     ${icon} ${durationMs}ms${message ? ` | ${message}` : ''}`);

    if (!success) {
      return {
        success: false,
        steps: results,
        failedStepIndex: i + 1,
        failedStepMessage: message,
      };
    }
  }

  return {
    success: true,
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
  backend: BackendClient,
  updateBaseline: boolean = false
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

    case 'wait_for': {
      if (!step.assert) throw new Error('wait_for requires assert');
      const maxMs = step.ms ?? 90000;
      const interval = step.interval ?? 3000;
      const wfStart = Date.now();
      let lastMessage = '';

      while (Date.now() - wfStart < maxMs) {
        const assertResult = await executeAssert(step.assert, port, backend, {});
        if (assertResult.success) {
          console.log(`     ⏱️  Condition met after ${Date.now() - wfStart}ms`);
          break;
        }
        lastMessage = assertResult.message || '';
        await sleep(interval);
      }

      if (Date.now() - wfStart >= maxMs) {
        throw new Error(`wait_for timeout after ${maxMs}ms: ${lastMessage}`);
      }
      break;
    }

    case 'screenshot': {
      if (!step.path) throw new Error('screenshot requires path');
      const fullPath = resolve(PROJECT_ROOT, step.path);
      const parentDir = dirname(fullPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      const res = await mrcScreenshot(fullPath, port);
      if (!res.success) throw new Error(res.error || 'screenshot failed');
      result.screenshotPath = fullPath;
      console.log(`     📸 Screenshot saved: ${fullPath}`);

      // Baseline comparison
      if (step.compare_with_baseline) {
        const baselinePath = fullPath.replace('/actual/', '/baseline/');
        const diffPath = fullPath.replace('/actual/', '/diff/');

        if (!existsSync(baselinePath)) {
          if (updateBaseline) {
            saveAsBaseline(fullPath, baselinePath);
            console.log(`     📝 Baseline created: ${baselinePath}`);
          } else {
            throw new Error(
              `Baseline not found: ${baselinePath}. Run with --update-baseline to create it.`
            );
          }
        } else {
          const threshold = step.threshold ?? 0.1;
          const cmp = compareScreenshot(fullPath, baselinePath, diffPath, threshold);
          if (cmp.match) {
            console.log(`     ✅ Screenshot matches baseline (${(cmp.diffRatio * 100).toFixed(2)}% diff)`);
          } else {
            throw new Error(
              `Screenshot diff: ${(cmp.diffRatio * 100).toFixed(2)}% pixels differ (threshold: ${(threshold * 100).toFixed(0)}%). Diff saved: ${diffPath}`
            );
          }
        }
      }
      break;
    }

    case 'mock': {
      if (!step.url) throw new Error('mock requires url');
      const responseJson = step.expected ? JSON.stringify(step.expected) : '{}';
      const res = await mrcMock(step.url, responseJson, port);
      if (!res.success) throw new Error(res.error || 'mock failed');
      break;
    }

    case 'clearMocks': {
      const res = await mrcClearMocks(port);
      if (!res.success) throw new Error(res.error || 'clearMocks failed');
      break;
    }

    case 'assert_element':
    case 'assert_evaluate':
    case 'db_assert': {
      // Pure assertions, handled by executeAssert
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
      const expected = assert.exists !== false;
      if (exists !== expected) {
        return {
          success: false,
          message: `Expected element ${assert.selector} exists=${expected}, got ${exists}`,
        };
      }
      return { success: true };
    }

    case 'evaluate_equals':
    case 'evaluate_script': {
      if (!assert.script) return { success: false, message: 'script required' };
      const resolvedScript = replaceVars(assert.script, vars);
      const res = await mrcEvaluate(resolvedScript, port);
      if (!res.success) return { success: false, message: res.error };
      const actual = res.data;
      if (assert.expected !== undefined) {
        if (!deepEqual(actual, assert.expected)) {
          return {
            success: false,
            message: `Expected ${JSON.stringify(assert.expected)}, got ${JSON.stringify(actual)}`,
          };
        }
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

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
