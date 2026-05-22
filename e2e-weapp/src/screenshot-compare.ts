/**
 * Screenshot comparison using pixelmatch + pngjs.
 *
 * Compares an actual screenshot against a baseline. If they differ beyond
 * the threshold, a diff image is generated for human review.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export interface CompareResult {
  match: boolean;
  diffPixels: number;
  diffRatio: number; // 0.0 ~ 1.0
  totalPixels: number;
}

/**
 * Compare two PNG screenshots.
 *
 * @param actualPath   Path to the actual screenshot
 * @param baselinePath Path to the baseline screenshot
 * @param diffPath     Path to write the diff image (if any)
 * @param threshold    Allowed diff ratio (0.0 ~ 1.0). Default 0.1 (10%)
 */
export function compareScreenshot(
  actualPath: string,
  baselinePath: string,
  diffPath: string,
  threshold: number = 0.1
): CompareResult {
  if (!existsSync(actualPath)) {
    throw new Error(`Actual screenshot not found: ${actualPath}`);
  }
  if (!existsSync(baselinePath)) {
    throw new Error(`Baseline screenshot not found: ${baselinePath}`);
  }

  const actual = PNG.sync.read(readFileSync(actualPath));
  const baseline = PNG.sync.read(readFileSync(baselinePath));

  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    throw new Error(
      `Dimension mismatch: actual ${actual.width}x${actual.height} vs baseline ${baseline.width}x${baseline.height}`
    );
  }

  const { width, height } = actual;
  const diff = new PNG({ width, height });

  const diffPixels = pixelmatch(
    actual.data,
    baseline.data,
    diff.data,
    width,
    height,
    { threshold: 0.1, includeAA: false } // pixel-level threshold
  );

  const totalPixels = width * height;
  const diffRatio = totalPixels > 0 ? diffPixels / totalPixels : 0;
  const match = diffRatio <= threshold;

  if (!match) {
    const diffDir = dirname(diffPath);
    if (!existsSync(diffDir)) {
      mkdirSync(diffDir, { recursive: true });
    }
    writeFileSync(diffPath, PNG.sync.write(diff));
  }

  return { match, diffPixels, diffRatio, totalPixels };
}

/**
 * Copy the actual screenshot to become the new baseline.
 */
export function saveAsBaseline(actualPath: string, baselinePath: string): void {
  if (!existsSync(actualPath)) {
    throw new Error(`Cannot update baseline: actual screenshot not found: ${actualPath}`);
  }
  const baselineDir = dirname(baselinePath);
  if (!existsSync(baselineDir)) {
    mkdirSync(baselineDir, { recursive: true });
  }
  copyFileSync(actualPath, baselinePath);
}
