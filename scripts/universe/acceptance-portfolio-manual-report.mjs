import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const origin = 'http://localhost:4310';
const digest = value => createHash('sha256').update(value).digest('hex');
const compact = value => value.replace(/[\s\u202f\u00a0]/g, '');

// Independent CSV reader: do not reuse the app's report rows or decimal helper.
function csvRecords(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') { quoted = false; }
      else { field += char; }
    } else if (char === '"') { quoted = true; }
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else { field += char; }
  }
  assert.equal(quoted, false, 'Downloaded CSV must have balanced quoting');
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  assert.deepEqual(header, ['asset', 'holding', 'share', 'value', 'source', 'kind', 'quantity', 'unit_price', 'quote_currency', 'effective_at']);
  return rows.map(values => {
    assert.equal(values.length, header.length);
    return Object.fromEntries(header.map((name, index) => [name, values[index]]));
  });
}

async function until(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  do {
    if (await check()) { return; }
    await new Promise(resolve => setTimeout(resolve, 75));
  } while (Date.now() < deadline);
  assert.fail(message);
}

/**
 * Uses the caller's existing single unlocked disposable manual-only page.
 * Adds only uniquely named test positions through real controls; leaves them
 * available for artifact review. It starts no browser/server, injects no API
 * data and changes no runtime command file. No passphrase is written to disk.
 * PDF creation is recorded separately from independent PDF content inspection.
 */
export async function checkManualPortfolioReport(page, output, screenshots, { passphrase, portfolioPath }) {
  assert.equal(new URL(page.url()).origin, origin);
  assert.equal(new URL(page.url()).pathname, portfolioPath);
  assert.match(portfolioPath, /^\/portfolio\/p\/[^/]+\/overview$/);
  assert.ok(typeof passphrase === 'string' && passphrase.length >= 8);
  mkdirSync(dirname(output), { recursive: true }); mkdirSync(screenshots, { recursive: true });
  const suffix = randomUUID().slice(0, 8);
  const prefix = 'Local report ' + suffix;
  const positions = [
    { name: prefix + ' exact lot', kind: 'asset', quantity: '9007199254740993.12345678', unitPrice: '0.00000003', currency: 'USD', value: '270215977.6422297937037034' },
    { name: prefix + ' liability', kind: 'liability', quantity: '2.50', unitPrice: '4', currency: 'EUR', value: '10' },
    { name: '=Local_report_' + suffix, kind: 'asset', quantity: '0.00000001', unitPrice: '', currency: '', value: 'Unpriced' },
  ];
  const shell = page.locator('app-portfolio-shell');
  const privacy = shell.getByRole('button', { name: /^Privacy(?: on)?$/ });
  const showValues = async () => {
    // The actual control cycles open -> values-hidden -> presentation -> open.
    for (let step = 0; step < 3 && await privacy.getAttribute('aria-pressed') === 'true'; step++) { await privacy.click(); }
    assert.equal(await privacy.getAttribute('aria-pressed'), 'false');
  };
  const editor = page.locator('app-manual-positions');
  const report = page.locator('app-report-builder');
  const checks = [];
  let phase = 'manual-editor';
  const safe = value => String(value).split(passphrase).join('[redacted]');
  const save = failure => writeFileSync(output, JSON.stringify({
    checkedAt: new Date().toISOString(), origin, portfolioPath,
    scope: 'Actual local manual-entry UI, encrypted reload, privacy, populated manual-only preview and CSV. No authoritative holdings, prices, shares, network or chain acceptance.',
    checks, ...(failure ? { failure } : {}),
  }, null, 2) + '\n');
  const pass = (id, scope, evidence = {}) => { checks.push({ id, status: 'PASS LOCAL', scope, ...evidence }); save(); };
  const row = (host, name) => host.locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  const form = async position => {
    if (!(await editor.locator('details').evaluate(element => element.open))) {
      await editor.locator('summary').click();
    }
    await editor.getByLabel('Position name', { exact: true }).fill(position.name);
    await editor.getByLabel(/^Position type/).selectOption(position.kind);
    await editor.getByLabel('Exact quantity', { exact: true }).fill(position.quantity);
    await editor.getByLabel('Unit price (optional)', { exact: true }).fill(position.unitPrice);
    await editor.getByLabel('Price currency', { exact: true }).fill(position.currency);
    await editor.getByLabel('Effective date', { exact: true }).fill('2026-09-06');
    await editor.getByRole('button', { name: 'Save manual position', exact: true }).click();
    await until(async () => await row(editor, position.name).count() === 1 && compact(await row(editor, position.name).innerText()).includes(position.quantity), 'Saved manual row must contain its exact entered quantity');
    await editor.getByText('Manual position saved in this encrypted vault.', { exact: true }).waitFor();
  };
  const download = async filename => {
    const next = page.waitForEvent('download');
    await report.getByRole('button', { name: 'Download CSV', exact: true }).click();
    const artifact = await next;
    assert.equal(artifact.suggestedFilename(), 'portfolio-report.csv');
    assert.equal(await artifact.failure(), null);
    const path = resolve(dirname(output), filename);
    await artifact.saveAs(path);
    const bytes = readFileSync(path);
    return { path, bytes, rows: csvRecords(bytes.toString('utf8')) };
  };

  try {
    await editor.getByRole('heading', { name: 'Manual positions', exact: true }).waitFor();
    await showValues();
    for (const position of positions) { await form(position); }
    // Exercise actual edit and remove without changing any pre-existing rows.
    const temporary = { ...positions[2], name: prefix + ' remove me' };
    await form(temporary);
    await row(editor, temporary.name).getByRole('button', { name: 'Remove', exact: true }).click();
    await until(async () => await row(editor, temporary.name).count() === 0, 'Removed test position must disappear');
    await row(editor, positions[1].name).getByRole('button', { name: 'Edit', exact: true }).click();
    await form({ ...positions[1], quantity: '2.5000' });
    positions[1].quantity = '2.5000';
    pass('Q05-manual-entry', 'Real form saves exact user-entered asset/liability/unpriced records, edits one ID and removes a temporary row', { testPositions: positions.length });

    phase = 'encrypted-reload';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await shell.getByText('Unlock the portfolio vault to open this portfolio.', { exact: true }).waitFor();
    assert.equal(await editor.count(), 0);
    await shell.getByRole('link', { name: 'Open portfolios', exact: true }).click();
    await page.getByRole('heading', { name: 'Portfolio locked', exact: true }).waitFor();
    await page.getByLabel('Passphrase', { exact: true }).fill(passphrase);
    await page.getByRole('button', { name: 'Unlock', exact: true }).click();
    await editor.getByRole('heading', { name: 'Manual positions', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, portfolioPath);
    for (const position of positions) {
      const text = compact(await row(editor, position.name).innerText());
      assert.ok(text.includes(position.quantity)); assert.ok(text.includes(position.value));
    }
    assert.equal(await row(editor, temporary.name).count(), 0);
    pass('Q05-manual-persistence', 'All saved manual entries and edited exact quantities survive a full reload and actual vault unlock; removed row stays absent');

    phase = 'active-editor-privacy';
    await row(editor, positions[0].name).getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await editor.getByLabel('Exact quantity', { exact: true }).inputValue(), positions[0].quantity);
    await privacy.click();
    await until(async () => await editor.locator('input').count() === 0, 'Privacy must remove actual editor inputs from the DOM');
    const hidden = compact(await editor.innerText());
    assert.equal(hidden.includes(positions[0].quantity), false);
    assert.equal(hidden.includes(positions[0].value), false);
    await page.screenshot({ path: resolve(screenshots, 'manual-active-editor-privacy.png'), fullPage: true });
    await showValues();
    assert.equal(await editor.getByLabel('Exact quantity', { exact: true }).inputValue(), '');
    pass('Q05-manual-privacy', 'Turning privacy on while editing removes input values and absolute table values; showing values returns an empty draft');

    phase = 'populated-preview';
    await shell.getByRole('link', { name: 'Reports', exact: true }).click();
    await report.getByRole('heading', { name: 'Redacted report', exact: true }).waitFor();
    const preview = report.locator('[aria-label="Manual report preview"]');
    await preview.waitFor();
    assert.equal(await report.locator('[aria-label="Report preview"] tbody tr').count(), 0, 'This helper accepts only a manual-only test portfolio');
    const disclosure = await preview.innerText();
    assert.ok(disclosure.includes('User-entered quantities and unit prices'));
    assert.ok(disclosure.includes('not verified balances or market prices'));
    assert.ok(disclosure.includes('no combined total or allocation is claimed'));
    for (const position of positions) {
      const text = compact(await row(preview, position.name).innerText());
      assert.ok(text.includes(position.quantity)); assert.ok(text.includes(position.value));
    }
    assert.equal(await report.getByRole('button', { name: 'Create encrypted link', exact: true }).isDisabled(), true);
    await page.screenshot({ path: resolve(screenshots, 'manual-populated-report.png'), fullPage: true });
    pass('Q05-P28-manual-preview', 'Populated manual-only preview retains exact quantities and separate USD/EUR estimates, identifies unpriced entries and user-entered authority; encrypted share stays disabled');

    phase = 'actual-csv';
    const csv = await download('manual-report-' + suffix + '.csv');
    assert.ok(csv.rows.every(entry => entry.source === 'User-entered' && entry.holding === '' && entry.share === 'Not combined'));
    for (const position of positions) {
      const name = position.name.startsWith('=') ? "'" + position.name : position.name;
      const rows = csv.rows.filter(entry => entry.asset === name); assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], { asset: name, holding: '', share: 'Not combined', value: position.value, source: 'User-entered', kind: position.kind,
        quantity: position.quantity, unit_price: position.unitPrice || 'Not supplied', quote_currency: position.currency, effective_at: '2026-09-06' });
    }
    pass('Q05-P29-manual-csv', 'Actual downloaded CSV independently parses to exact amounts and dates; mixed currencies and liability remain separate, unpriced has no invented price and formula-leading name is literal spreadsheet text', { artifact: csv.path, sha256: digest(csv.bytes), manualRows: csv.rows.length });

    phase = 'redacted-csv';
    await report.getByLabel(/^Values/).selectOption('percentages');
    await until(async () => !(await preview.innerText()).includes(positions[0].quantity), 'Value redaction must affect the actual preview');
    const redacted = await download('manual-report-redacted-' + suffix + '.csv');
    assert.ok(redacted.rows.every(entry => entry.quantity === 'Hidden' && entry.unit_price === 'Hidden' && entry.value === 'Hidden' && entry.share === 'Not combined'));
    pass('Q05-P29-manual-redaction', 'Actual redacted CSV hides quantity, unit price and value without inventing manual allocation percentages', { artifact: redacted.path, sha256: digest(redacted.bytes) });
    await report.getByLabel(/^Values/).selectOption('absolute');

    phase = 'actual-print-and-pdf';
    await page.evaluate(() => {
      window.__acceptanceManualPrintEvents = 0;
      window.addEventListener('beforeprint', () => { window.__acceptanceManualPrintEvents++; }, { once: true });
    });
    await report.getByRole('button', { name: 'Print / save PDF', exact: true }).click();
    await until(() => page.evaluate(() => window.__acceptanceManualPrintEvents > 0), 'The real print control must invoke the browser print lifecycle');
    pass('Q05-P28-manual-print', 'Actual Print / save PDF button invokes the browser beforeprint lifecycle for the populated manual report');
    const pdfPath = resolve(dirname(output), 'manual-report-' + suffix + '.pdf');
    const pdf = await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.length > 1000);
    checks.push({ id: 'Q05-P28-manual-pdf', status: 'ARTIFACT GENERATED; INSPECTION REQUIRED', scope: 'Native Chromium PDF artifact from the populated report. Independent text/layout inspection must verify the expected exact rows and disclosures before PDF acceptance.', artifact: pdfPath, sha256: digest(pdf), bytes: pdf.length,
      expected: positions.map(({ name, quantity, unitPrice, currency, value }) => ({ name, quantity, unitPrice: unitPrice || 'Not supplied', currency, value })),
      expectedDisclosure: 'User-entered quantities and unit prices; not verified balances or market prices; no combined total or allocation is claimed',
    }); save();
    await shell.getByRole('link', { name: 'Overview', exact: true }).click();
    await editor.waitFor();
    return { localManualChecks: checks.filter(check => check.status === 'PASS LOCAL').length, pdfArtifact: pdfPath, portfolioPath };
  } catch (error) {
    const failure = { phase, message: safe(error instanceof Error ? error.message : error) };
    save(failure); throw new Error(phase + ': ' + failure.message);
  }
}
