import execa = require('execa');
import type { MRCResult } from './types';

const MRC_TIMEOUT = 60000; // 60s per command
const MRC_RETRY = 2;

export async function mrc<T = any>(
  command: string,
  args: string[] = [],
  port: number
): Promise<MRCResult<T>> {
  const fullArgs = [command, ...args, '--port', String(port), '--json'];
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MRC_RETRY; attempt++) {
    try {
      const { stdout, stderr } = await execa('mrc', fullArgs, {
        timeout: MRC_TIMEOUT,
        reject: false, // Don't throw on non-zero exit; we parse ourselves
      });

      const output = stdout || stderr || '';

      // Try to parse JSON from the output (mrc --json outputs JSON at the end)
      const outputStr = output.trim();
      let jsonData: any = null;

      // First try: find a complete JSON object from the first '{' to the last '}'
      const firstBrace = outputStr.indexOf('{');
      const lastBrace = outputStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        try {
          jsonData = JSON.parse(outputStr.substring(firstBrace, lastBrace + 1));
        } catch {
          // not valid JSON, fall through
        }
      }

      // Fallback: try each line starting with '{' from the end
      if (!jsonData) {
        const lines = outputStr.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{')) {
            try {
              jsonData = JSON.parse(line);
              break;
            } catch {
              // not valid JSON, continue
            }
          }
        }
      }

      // Check if the command actually succeeded
      // mrc usually prints a checkmark on success
      const success = output.includes('✅') || (jsonData && jsonData.success !== false);

      return {
        success,
        data: jsonData,
        rawOutput: output,
        error: success ? undefined : output,
      };
    } catch (err: any) {
      lastError = err.message || String(err);
      if (attempt < MRC_RETRY) {
        await sleep(500);
      }
    }
  }

  return {
    success: false,
    data: null as any,
    rawOutput: '',
    error: `mrc ${command} failed after ${MRC_RETRY + 1} attempts: ${lastError}`,
  };
}

export async function mrcScreenshot(path: string, port: number): Promise<MRCResult> {
  return mrc('screenshot', [path], port);
}

export async function mrcExists(selector: string, port: number): Promise<MRCResult<{ exists: boolean }>> {
  return mrc('exists', [selector], port);
}

export async function mrcTap(selector: string, port: number): Promise<MRCResult> {
  return mrc('tap', [selector], port);
}

export async function mrcEvaluate(script: string, port: number): Promise<MRCResult> {
  // Wrap script to return JSON-serializable result
  return mrc('evaluate', [script], port);
}

export async function mrcRelaunch(url: string, port: number): Promise<MRCResult> {
  return mrc('relaunch', [url], port);
}

export async function mrcSwitchTab(url: string, port: number): Promise<MRCResult> {
  return mrc('switchTab', [url], port);
}

export async function mrcBack(port: number): Promise<MRCResult> {
  return mrc('back', [], port);
}

export async function mrcWait(ms: number, port: number): Promise<MRCResult> {
  return mrc('wait', [String(ms)], port);
}

export async function mrcMock(url: string, responseJson: string, port: number): Promise<MRCResult> {
  return mrc('mock', [url, responseJson], port);
}

export async function mrcClearMocks(port: number): Promise<MRCResult> {
  return mrc('clearMocks', [], port);
}

export async function mrcSetData(data: Record<string, any>, port: number): Promise<MRCResult> {
  return mrc('setData', [JSON.stringify(data)], port);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
