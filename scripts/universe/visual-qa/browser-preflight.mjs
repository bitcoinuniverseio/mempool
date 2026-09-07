#!/usr/bin/env node
// Launch only: a passing prerequisite does not certify any application page.
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { version: playwrightVersion } = require('playwright/package.json');
let browser;
try {
  browser = await chromium.launch({ headless: true, timeout: 30_000 });
  const browserVersion = browser.version();
  await browser.close();
  browser = null;
  console.log(JSON.stringify({ prerequisite: 'browser-launch', status: 'PASS',
    playwrightVersion, browserVersion, executablePath: chromium.executablePath() }));
} catch (error) {
  console.error(JSON.stringify({ prerequisite: 'browser-launch', status: 'BLOCKED',
    playwrightVersion, executablePath: chromium.executablePath(), error: error.message }));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
