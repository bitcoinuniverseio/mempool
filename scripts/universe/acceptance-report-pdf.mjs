import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

// Read/render the actual browser PDF, independently of Angular or Chromium.
// The dependency directory is supplied by the local bundled runtime; no install.
const [reportPath, runtimeRoot, outputPath] = process.argv.slice(2);
assert(reportPath && runtimeRoot && outputPath, 'Usage: acceptance-report-pdf.mjs report.json runtime-directory output.json');
const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
const pdfRow = report.checks.find(row => row.id === 'Q05-P28-manual-pdf');
assert(pdfRow?.artifact && pdfRow.expected?.length, 'The actual generated manual report PDF and expectations are required');
const require = createRequire(resolve(runtimeRoot, 'package.json'));
const canvasModule = require('@napi-rs/canvas');
for (const name of ['DOMMatrix', 'ImageData', 'Path2D']) globalThis[name] = canvasModule[name];
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
const bytes = readFileSync(pdfRow.artifact);
const sha256 = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha256(bytes), pdfRow.sha256, 'PDF bytes changed after browser generation');
const document = await pdfjs.getDocument({ data: new Uint8Array(bytes),
  standardFontDataUrl: join(pdfRoot, 'standard_fonts') + '/', cMapUrl: join(pdfRoot, 'cmaps') + '/',
  cMapPacked: true, useSystemFonts: true, isEvalSupported: false }).promise;
assert.equal(document.numPages, 1, 'This three-row manual report must fit one A4 page without navigation/footer pages');
const pages = [], text = [];
mkdirSync(dirname(resolve(outputPath)), { recursive: true });
for (let number = 1; number <= document.numPages; number++) {
  const page = await document.getPage(number);
  const content = await page.getTextContent();
  text.push(content.items.filter(item => 'str' in item).map(item => item.str).join(' '));
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
  const image = resolve(dirname(outputPath), 'manual-report-pdf-page-' + number + '.png');
  writeFileSync(image, canvas.toBuffer('image/png'));
  pages.push({ page: number, width: viewport.width, height: viewport.height, image });
}
const actual = text.join('\n');
const compact = value => value.replace(/[\s,\u202f\u00a0]/g, '');
const flat = compact(actual);
for (const row of pdfRow.expected) {
  for (const value of [row.name, row.quantity, row.value, row.unitPrice, row.currency].filter(Boolean)) {
    assert(flat.includes(compact(value)), 'Actual PDF is missing expected text: ' + value);
  }
}
for (const disclosure of ['User-entered quantities and unit prices', 'not verified balances or market prices', 'no combined total or allocation is claimed']) {
  assert(flat.includes(compact(disclosure)), 'Actual PDF is missing disclosure: ' + disclosure);
}
writeFileSync(resolve(outputPath), JSON.stringify({ checkedAt: new Date().toISOString(), scope: 'Independent PDF text and rendered-page inspection preparation',
  pdf: pdfRow.artifact, pdfSha256: pdfRow.sha256, expectedRows: pdfRow.expected.length, textAssertions: 'PASS LOCAL',
  visualInspection: 'PENDING', pages }, null, 2) + '\n');
await document.destroy();
console.log(JSON.stringify({ pages: pages.length, exactRows: pdfRow.expected.length, textAssertions: 'PASS LOCAL', visualInspection: 'PENDING' }));

