import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const require = createRequire('D:/universe/mempool/mempool/scripts/universe/visual-qa/package.json');
const { chromium } = require('playwright');
const original = JSON.parse(fs.readFileSync(new URL('overlay-process.json', import.meta.url)));
assert.equal(original.pid, 82804);
assert.equal(original.script, 'D:/universe/backend-apis/.tmp/explorer-health-cc524f6d97b5/dist/universe-explorer-main.js');
const result = { startedAt: new Date().toISOString(), scope: 'owned local overlay stop and restart only; no production change', original, checks: [], requests: [] };
const browser = await chromium.launch({ headless: true, executablePath: chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
let stopped = false;
let restarted = false;
page.on('response', response => { if (response.url().includes('/api/v1/chains')) result.requests.push({ status: response.status(), time: new Date().toISOString() }); });
async function poll(fn, duration = 20000) {
  const until = Date.now() + duration;
  while (Date.now() < until) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('Bounded recovery assertion timed out');
}
function restart() {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('start-candidate.mjs', import.meta.url)), 'overlay'], { windowsHide: true, encoding: 'utf8' });
  if (child.status !== 0) throw new Error(child.stderr || 'Local overlay restart failed');
  restarted = true; result.restarted = JSON.parse(child.stdout);
}
try {
  await page.goto('http://127.0.0.1:4310/block/00000000000000000001014ea6d7cc2bceaa744c0a57001db6150f7e6d95769d', { waitUntil: 'domcontentloaded' });
  await page.locator('.chain-toggle').waitFor();
  await poll(() => result.requests.some(r => r.status === 200));
  await page.getByRole('button', { name: 'Select blockchain' }).click();
  await page.locator('.chain-menu app-chain-health-details summary').click();
  process.kill(original.pid); stopped = true;
  await page.locator('.chain-menu app-chain-health-details button').click();
  await poll(() => result.requests.some(r => r.status === 502));
  await poll(async () => (await page.locator('.chain-current-state').innerText()).trim() === 'Status unknown');
  assert.equal(await page.locator('.chain-menu app-chain-health-details summary').count(), 0);
  const failedText = await page.locator('.chain-menu').innerText();
  assert.match(failedText, /Retry status/);
  result.checks.push({ name: 'actual gateway failure clears previously loaded health', status: 'PASS', text: failedText });
  await page.screenshot({ path: fileURLToPath(new URL('candidate-recovery-failed.png', import.meta.url)) });
  restart();
  await poll(async () => { try { return (await fetch('http://127.0.0.1:3400/api/v1/chains?network=mainnet', { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 25000);
  await page.locator('.chain-menu app-chain-health-details button').click();
  await page.locator('.chain-menu app-chain-health-details summary').waitFor({ timeout: 20000 });
  await page.locator('.chain-menu app-chain-health-details summary').click();
  const recovered = await page.locator('.chain-menu app-chain-health-details').innerText();
  assert.match(recovered, /Node · mempool-backend/);
  result.checks.push({ name: 'explicit retry repopulates independent health from same candidate', status: 'PASS', text: recovered });
  await page.screenshot({ path: fileURLToPath(new URL('candidate-recovery-restored.png', import.meta.url)) });
  result.status = 'PASS SCOPED LOCAL RECOVERY';
} catch (error) { result.status = 'FAIL'; result.error = error.message; }
finally {
  if (stopped && !restarted) { try { restart(); } catch (error) { result.restartError = error.message; } }
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(new URL('candidate-recovery-evidence.json', import.meta.url), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, error: result.error, restarted: result.restarted }));
}
