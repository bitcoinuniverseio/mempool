import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { composite, effectiveRatio, parseColor, requiredRatio } from './contrast.mjs';

const origin = 'http://localhost:4310';
const themes = ['default', 'dark', 'contrast'];
const pages = [
  { name: 'address', host: 'app-silent-payments-address', sample: 'Load Official Mainnet Sample', submit: 'Validate Address',
    api: 'validate-address', result: 'Valid BIP352 Address', targets: ['.nav-link.active', '.badge.bg-primary', '.badge.bg-secondary', 'h2.text-success'] },
  { name: 'psbt', host: 'app-silent-payments-psbt', sample: 'Load BIP375 Sample (unsigned)', submit: 'Inspect Fields',
    api: 'validate-psbt', result: 'PSBT Structure Inspection Result', targets: ['.nav-link.active', '.badge.bg-primary', '.badge.bg-secondary', '.badge.bg-success'] },
];

// Poll in Node: Playwright's waitForFunction can require unsafe-eval under CSP.
async function poll(read, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await new Promise(done => setTimeout(done, 75));
  }
  throw new Error('Timed out waiting for ' + description);
}

async function selectTheme(page, theme) {
  await page.locator('#theme-select').selectOption(theme, { timeout: 10000 });
  return poll(() => page.evaluate(expected => {
    const select = document.querySelector('#theme-select');
    if (!select || select.value !== expected || select.disabled) return null;
    const themeFiles = window.__env?.THEME_FILES || {};
    const href = name => new URL(themeFiles[name] || name + '.css', document.baseURI).href;
    const links = [...document.querySelectorAll('link[rel=stylesheet]')];
    const active = links.filter(link => !link.disabled && (!link.media || matchMedia(link.media).matches));
    if (expected === 'default') {
      if (active.some(link => ['dark', 'contrast'].some(name => link.href === href(name)))) return null;
    } else {
      const loaded = active.find(link => link.href === href(expected));
      if (!loaded?.sheet) return null;
      try { if (!loaded.sheet.cssRules.length) return null; } catch { return null; }
    }
    const style = getComputedStyle(document.documentElement);
    return { selected: select.value, disabled: select.disabled,
      stylesheets: active.map(link => ({ href: link.href, loaded: !!link.sheet, media: link.media })),
      tokens: Object.fromEntries(['--u-brand', '--u-brand-contrast', '--u-state-neutral', '--u-state-neutral-surface',
        '--u-state-proven', '--u-state-proven-surface'].map(name => [name, style.getPropertyValue(name).trim()])) };
  }, theme), 'loaded and applied ' + theme + ' stylesheet');
}

/** Solid CSS layers, from the text element outward, including group opacity. */
export function measureTextContrast(sample) {
  let ink = parseColor(sample.color), surface = { r: 0, g: 0, b: 0, a: 0 };
  assert(ink, 'Unrecognized foreground color');
  for (const layer of sample.layers) {
    const background = parseColor(layer.backgroundColor);
    assert(background, 'Unrecognized background color');
    assert(layer.backgroundImage === 'none' || surface.a >= 1,
      'A visible background image requires separate pixel-based inspection');
    assert(Number.isFinite(layer.opacity) && layer.opacity >= 0 && layer.opacity <= 1, 'Unrecognized opacity');
    ink = composite(ink, background);
    surface = composite(surface, background);
    ink.a *= layer.opacity;
    surface.a *= layer.opacity;
  }
  assert(surface.a >= 1, 'Transparent page canvas cannot establish an exact contrast ratio');
  const ratio = effectiveRatio(ink, surface);
  const minimum = requiredRatio(sample);
  assert(Number.isFinite(ratio), 'Unresolved contrast ratio');
  return { ratio, minimum, passed: ratio >= minimum, effectiveForeground: ink, effectiveBackground: surface };
}

async function submitSample(page, spec) {
  const host = page.locator(spec.host);
  const run = async button => {
    const responsePromise = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === '/api/v1/intelligence/payments/silent/' + spec.api && response.request().method() === 'POST';
    }, { timeout: 10000 });
    const [response] = await Promise.all([
      responsePromise,
      host.getByRole('button', { name: button, exact: true }).click({ timeout: 10000 }),
    ]);
    const actual = await response.json();
    assert.equal(response.status(), 200, spec.api + ' HTTP status');
    assert.equal(actual.valid, true, spec.api + ' response must be valid');
    await poll(() => host.evaluate((element, heading) => [...element.querySelectorAll('h2')].some(node => node.textContent.includes(heading)), spec.result), 'rendered ' + spec.result);
    return { url: response.url(), method: response.request().method(), status: response.status(),
      requestId: response.headers()['x-request-id'] || null, valid: actual.valid,
      network: actual.network || null, bip375Present: actual.bip375_present ?? null, bip376Present: actual.bip376_present ?? null };
  };
  // The official sample button performs a real request, then exercise submit too.
  return { sample: await run(spec.sample), submit: await run(spec.submit) };
}

/** Use only the caller's existing page; never launches a browser or a service. */
export async function checkSilentPaymentContrast(page, output, screenshots) {
  assert.equal(new URL(page.url()).origin, origin);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(screenshots, { recursive: true });
  const initialViewport = page.viewportSize();
  const initialTheme = await page.locator('#theme-select').inputValue();
  const report = { schemaVersion: 'universe-silent-payment-contrast-v1', origin,
    scope: 'Actual local sample form submissions, loaded theme styles, computed text contrast and viewport overflow; no chain, signing or broadcast acceptance',
    startedAt: new Date().toISOString(), realNetworkE2ePasses: 0, checks: [] };
  const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  try {
    for (const width of [390, 768, 1440]) for (const theme of themes) for (const spec of pages) {
      const row = { id: `SP-${spec.name === 'address' ? '05' : '06'}-CONTRAST-${theme}-${width}`,
        route: '/payments/silent/' + spec.name, theme, width, status: 'FAIL', checkedAt: new Date().toISOString() };
      report.checks.push(row);
      try {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
        await page.goto(origin + row.route, { waitUntil: 'domcontentloaded' });
        await page.locator(spec.host).waitFor({ state: 'visible' });
        row.themeState = await selectTheme(page, theme);
        row.requests = await submitSample(page, spec);
        await page.evaluate(() => window.scrollTo(0, 0));
        row.layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth, path: location.pathname }));
        assert.equal(row.layout.path, row.route);
        row.samples = [];
        for (const selector of spec.targets) {
          const samples = await page.locator(spec.host + ' ' + selector).evaluateAll(elements => elements.map(element => {
            const style = getComputedStyle(element), rect = element.getBoundingClientRect();
            const layers = [];
            for (let node = element; node; node = node.parentElement) {
              const computed = getComputedStyle(node);
              layers.push({ tag: node.tagName, backgroundColor: computed.backgroundColor,
                backgroundImage: computed.backgroundImage, opacity: Number(computed.opacity) });
            }
            return { text: element.textContent.trim(), color: style.color, fontSizePx: parseFloat(style.fontSize),
              fontWeight: parseInt(style.fontWeight, 10), width: rect.width, height: rect.height, layers };
          }));
          assert(samples.length > 0, spec.name + ' missing expected ' + selector);
          for (const sample of samples) {
            assert(sample.width > 0 && sample.height > 0, 'Expected contrast target is hidden');
            row.samples.push({ selector, ...sample, ...measureTextContrast(sample) });
          }
        }
        row.screenshot = resolve(screenshots, 'silent-' + spec.name + '-' + theme + '-' + width + '.png');
        await page.screenshot({ path: row.screenshot, fullPage: true });
        assert(row.layout.scrollWidth <= width + 1 && row.layout.bodyScrollWidth <= width + 1, 'Horizontal overflow at ' + width);
        assert(row.samples.every(sample => sample.passed), 'Insufficient text contrast: ' + row.samples.filter(sample => !sample.passed).map(sample => sample.selector).join(', '));
        row.status = 'PASS LOCAL';
      } catch (error) {
        row.error = error.message;
        row.screenshot ||= resolve(screenshots, 'silent-' + spec.name + '-' + theme + '-' + width + '-failure.png');
        try { await page.screenshot({ path: row.screenshot, fullPage: true }); } catch {}
      }
      save();
    }
  } finally {
    try {
      report.restoredTheme = await selectTheme(page, initialTheme);
    } catch (error) { report.restorationError = error.message; }
    try {
      if (initialViewport) await page.setViewportSize(initialViewport);
      report.restoredViewport = page.viewportSize();
    } catch (error) { report.restorationError = [report.restorationError, error.message].filter(Boolean).join('; '); }
    report.completedAt = new Date().toISOString();
    save();
  }
  assert.equal(report.checks.length, 18);
  assert.equal(report.checks.filter(row => row.status !== 'PASS LOCAL').length, 0, 'Contrast/viewport checks failed; see ' + output);
  assert(!report.restorationError, 'Could not restore caller theme/viewport');
  return report;
}
