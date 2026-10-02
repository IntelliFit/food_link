/** Verify the offline report only; this is not Mini Program runtime acceptance. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, '../../..');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
if (!process.argv.includes('--modules') || !process.argv.includes('--output')) throw new Error('Pass --modules and --output');
const output = path.resolve(arg('--output'));
await fs.mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(arg('--modules'), 'playwright'));
const source = await fs.readFile(path.join(dir, 'report.md'), 'utf8');
const expected = {
  images: [...source.matchAll(/^!\[/gm)].length,
  tables: [...source.matchAll(/^\|\s*[-:]+/gm)].length,
  headings: [...source.matchAll(/^#{1,4} /gm)].length,
};
const sha = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const originalHash = await sha(path.join(repo, 'apps/wechat/src/assets/pets/companions/companion-fbd87f73-v1.png'));
const copiedHash = await sha(path.join(dir, 'assets/current-guigui-sprite.png'));
if (originalHash !== copiedHash) throw new Error('Original character was changed');
const browser = await chromium.launch({ headless: true });
const errors = [];
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
    await page.evaluate(async () => {
      document.querySelectorAll('main img').forEach(i => i.loading = 'eager');
      await document.fonts.ready;
      await Promise.all([...document.querySelectorAll('main img')].map(i => i.decode()));
    });
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      images: document.querySelectorAll('main figure img').length,
      decodedImages: [...document.querySelectorAll('main figure img')].filter(i => i.complete && i.naturalWidth > 0).length,
      tables: document.querySelectorAll('main table').length,
      headings: document.querySelectorAll('main h1,main h2,main h3,main h4').length,
      anchorsValid: [...document.querySelectorAll('.toc a')].every(a => document.getElementById(a.hash.slice(1))),
    }));
    if (metrics.documentWidth > width || metrics.images !== expected.images || metrics.decodedImages !== expected.images || metrics.tables !== expected.tables || metrics.headings !== expected.headings || !metrics.anchorsValid) {
      throw new Error('Report layout/content mismatch: ' + JSON.stringify({ expected, metrics }));
    }
    await page.screenshot({ path: path.join(output, `html-${width}.png`) });
    const figure = page.locator('main figure img').first();
    await figure.scrollIntoViewIfNeeded();
    await figure.click();
    const zoomOpened = await page.locator('dialog').evaluate(d => d.open);
    await page.locator('dialog button').click();
    const zoomClosed = await page.locator('dialog').evaluate(d => !d.open);
    if (!zoomOpened || !zoomClosed) throw new Error('Figure zoom failed');
    results.push({ ...metrics, zoomOpened, zoomClosed });
    await page.close();
  }
  await fs.access(path.join(dir, 'pet-companion-design-report.pdf'));
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  const result = { reportOnly: true, notMiniProgramVerification: true, expected, originalCharacterSha256: originalHash, exactOriginalCopy: true, pdfLinkExists: true, errors, viewports: results };
  await fs.writeFile(path.join(output, 'web-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
