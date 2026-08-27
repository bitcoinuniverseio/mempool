#!/usr/bin/env node
/**
 * Keyboard and reduced-motion checks.
 *
 * Two things a screenshot cannot tell you: whether every control can be reached
 * and seen when reached, and whether the interface stops moving when a visitor
 * has asked their system for less motion.
 *
 * Tabs through the first N stops on a route and reports, for each one:
 *   - what it is, and whether it has an accessible name
 *   - whether a focus indicator is actually visible on it
 *   - whether it is inside the viewport when focused
 *
 * Then reloads with reduced motion and reports any element still running a
 * CSS animation or a non-instant transition.
 *
 * Usage:  node keyboard-check.mjs [--base=http://localhost:4300] [--route=/]
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as playwright from 'playwright';
import { addressFixtures, detailFixtures, fixtures } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const BASE = args.base || 'http://localhost:4300';
const ROUTES = String(args.route || '/,/protocols,/source').split(',');
const STOPS = Number(args.stops || 28);

const table = { ...fixtures, ...detailFixtures, ...addressFixtures };

async function withFixtures(context) {
  await context.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const hit = table[path] ?? table[Object.keys(table).find((k) => path.startsWith(k))];
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(hit ?? []),
    });
  });
  await context.routeWebSocket('**/api/v1/ws', () => {});
}

/** Does the focused element actually show that it is focused? */
function focusReport() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const name =
    el.getAttribute('aria-label') ||
    (el.labels && el.labels[0]?.textContent?.trim()) ||
    el.textContent?.trim().slice(0, 40) ||
    el.getAttribute('title') ||
    '';
  const outline =
    cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const ring =
    cs.boxShadow !== 'none' && cs.boxShadow !== '';
  return {
    tag: el.tagName.toLowerCase(),
    name,
    visibleFocus: outline || ring,
    inViewport:
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < window.innerHeight,
    size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
  };
}

/** Anything still moving after the visitor asked for less motion. */
function movingElements() {
  const moving = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    // A duration the reduced-motion rule has already collapsed to a hundredth
    // of a millisecond is stopped, not moving. Counting it as motion made the
    // check report failures against its own fix.
    const STOPPED = 0.05; // seconds
    const animated = cs.animationName !== 'none' && parseFloat(cs.animationDuration) > STOPPED;
    const transitioned =
      cs.transitionProperty !== 'none' &&
      cs.transitionProperty !== 'all' &&
      parseFloat(cs.transitionDuration) > 0.35 &&
      parseFloat(cs.transitionDuration) > STOPPED;
    if (animated || transitioned) {
      moving.push({
        selector: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
        animation: animated ? `${cs.animationName} ${cs.animationDuration}` : '',
        transition: transitioned ? `${cs.transitionProperty} ${cs.transitionDuration}` : '',
      });
    }
    if (moving.length > 25) break;
  }
  return moving;
}

const browser = await playwright.chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

let unnamed = 0;
let invisible = 0;

for (const route of ROUTES) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await withFixtures(context);
  const page = await context.newPage();
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  console.log(`\n=== ${route} : tab order ===`);
  const seen = [];
  for (let i = 0; i < STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(focusReport);
    if (!stop) continue;
    seen.push(stop);
    const flags = [];
    if (!stop.name) { flags.push('NO NAME'); unnamed++; }
    if (!stop.visibleFocus) { flags.push('NO VISIBLE FOCUS'); invisible++; }
    if (!stop.inViewport) flags.push('offscreen');
    console.log(
      `  ${String(i + 1).padStart(2)} ${stop.tag.padEnd(8)} ${stop.size.padEnd(9)} ` +
      `${(stop.name || '(unnamed)').slice(0, 44).padEnd(46)} ${flags.join(' ')}`,
    );
  }
  await context.close();
}

console.log('\n=== reduced motion ===');
const reduced = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
await withFixtures(reduced);
const rp = await reduced.newPage();
await rp.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await rp.waitForTimeout(2500);
const moving = await rp.evaluate(movingElements);
if (!moving.length) {
  console.log('  nothing is still animating or transitioning slowly');
} else {
  for (const m of moving) {
    console.log(`  ${m.selector.slice(0, 52).padEnd(54)} ${m.animation} ${m.transition}`);
  }
}
await reduced.close();
await browser.close();

console.log(`\nstops without an accessible name : ${unnamed}`);
console.log(`stops without a visible focus    : ${invisible}`);
console.log(`elements still moving (reduced)  : ${moving.length}\n`);
