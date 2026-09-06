import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { checkLocalPortfolio } from './acceptance-portfolio-browser.mjs';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'scripts/universe/visual-qa/package.json'));
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const errors = [];
const failedRequests = [];
const screenshots = resolve(root, '../audits/acceptance-20260905');
const page = await browser.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
try {
  console.log(await checkLocalPortfolio(page, resolve(root, 'docs/acceptance/browser-portfolio-2026-09-05.json'), screenshots));
  console.log({ errors, failedRequests, browserPages: (await browser.contexts()[0].pages()).length });
} catch (error) {
  const state = { error: error.message, errors, failedRequests, path: new URL(page.url()).pathname,
    rendered: await page.locator('body').innerText() };
  writeFileSync(resolve(root, '../.runtime/acceptance-portfolio-failure.json'), JSON.stringify(state, null, 2) + '\n');
  await page.screenshot({ path: resolve(screenshots, 'portfolio-failure.png'), fullPage: true });
  console.log(state);
  process.exitCode = 1;
} finally { await browser.close(); }
