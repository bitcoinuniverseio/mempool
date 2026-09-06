/**
 * Regression fixtures for the mobile gate, using a caller-owned Playwright page.
 * This module launches no browser or server. The caller can pass an older probe
 * to prove these fixtures reject the regression before checking the current one.
 * The supplied page is replaced with a local fixture document.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { mobileProbe, TOUCH_FLOOR, FIELD_FLOOR, mobileBrowserLaunchOptions } from './mobile-check.mjs';

export async function runMobileProbeRegressions(page, { probe = mobileProbe } = {}) {
  await page.setContent(`<!doctype html><html><head><style>
    body { margin: 8px; font: 16px sans-serif; }
    .scroll { width: 120px; max-width: 100%; height: 48px; overflow-x: auto; margin: 8px 0; }
    .wide { width: 400px; height: 24px; }
    pre { white-space: pre; }
    .control-row { min-height: 50px; }
    .probe-checkbox { appearance: none; display: inline-block; box-sizing: border-box; width: 28px; height: 28px; margin: 0; border: 1px solid; vertical-align: middle; }
    label { display: inline-flex; align-items: center; width: 120px; height: 44px; vertical-align: middle; }
  </style></head><body><main>
    <div id="bare-table" class="scroll table-responsive"><div class="wide">Table content</div></div>
    <pre id="bare-pre" class="scroll">Long code sample that remains wider than its containing region.</pre>
    <div class="table-responsive"><div id="nested-scroll" class="scroll"><div class="wide">Nested scroll content</div></div></div>
    <div id="role-only" class="scroll" role="region" aria-label="Missing keyboard focus"><div class="wide">Table content</div></div>
    <div id="named-table" class="scroll table-responsive" tabindex="0" role="region" aria-label="Transactions, scroll horizontally"><div class="wide">Table content</div></div>
    <pre id="named-pre" class="scroll" tabindex="0" role="region" aria-label="Code sample, scroll horizontally">Long code sample that remains wider than its containing region.</pre>
    <div class="control-row"><input id="no-label" class="probe-checkbox" type="checkbox"></div>
    <div class="control-row"><input id="explicit-label" class="probe-checkbox" type="checkbox"><label for="explicit-label">Visible label</label></div>
    <div class="control-row"><label><input id="implicit-label" class="probe-checkbox" type="checkbox">Wrapped label</label></div>
    <div class="control-row"><input id="display-none-label" class="probe-checkbox" type="checkbox"><label for="display-none-label" style="display:none">Hidden label</label></div>
    <div class="control-row"><input id="visibility-hidden-label" class="probe-checkbox" type="checkbox"><label for="visibility-hidden-label" style="visibility:hidden">Hidden label</label></div>
    <div class="control-row"><input id="opacity-zero-label" class="probe-checkbox" type="checkbox"><label for="opacity-zero-label" style="opacity:0">Hidden label</label></div>
    <div class="control-row"><input id="hidden-parent-label" class="probe-checkbox" type="checkbox"><span style="opacity:0"><label for="hidden-parent-label">Hidden parent</label></span></div>
    <div class="control-row"><input id="inert-label" class="probe-checkbox" type="checkbox"><span inert><label for="inert-label">Inert label</label></span></div>
    <div class="control-row"><input id="pointer-none-label" class="probe-checkbox" type="checkbox"><label for="pointer-none-label" style="pointer-events:none">Untappable label</label></div>
    <div class="control-row"><input id="zero-size-label" class="probe-checkbox" type="checkbox"><label for="zero-size-label" style="width:0;height:0;overflow:hidden">Zero size</label></div>
    <div class="control-row"><input id="unassociated-label" class="probe-checkbox" type="checkbox"><label for="missing-input">Unrelated label</label></div>
    <div class="control-row"><input id="multiple-labels" class="probe-checkbox" type="checkbox"><label for="multiple-labels" style="display:none">Hidden first label</label><label for="multiple-labels">Visible second label</label></div>
    <div class="control-row"><input id="large-input" class="probe-checkbox" type="checkbox" style="width:44px;height:44px"><label for="large-input" style="width:12px;height:12px">Small</label></div>
  </main></body></html>`, { waitUntil: 'domcontentloaded' });

  const result = await page.evaluate(probe, { touchFloor: TOUCH_FLOOR, fieldFloor: FIELD_FLOOR });
  const checks = [];
  const check = (name, passed, actual) => checks.push({ name, passed: Boolean(passed), actual });
  for (const [id, declared, keyboardReachable] of [
    ['bare-table', false, false],
    ['bare-pre', false, false],
    ['nested-scroll', false, false],
    ['role-only', true, false],
    ['named-table', true, true],
    ['named-pre', true, true],
  ]) {
    const seen = result.scrollers.find(scroller => scroller.el.includes(`#${id}.`));
    check(`${id}: declaration and keyboard access`,
      seen?.declared === declared && seen?.keyboardReachable === keyboardReachable, seen ?? null);
  }
  for (const id of ['no-label', 'display-none-label', 'visibility-hidden-label', 'opacity-zero-label',
    'hidden-parent-label', 'inert-label', 'pointer-none-label', 'zero-size-label', 'unassociated-label']) {
    check(`${id}: missing or unusable label cannot enlarge target`,
      result.targetsBelowPlatform.some(target => target.includes(`#${id}.`)), result.targetsBelowPlatform.filter(target => target.includes(`#${id}.`)));
  }
  for (const id of ['explicit-label', 'implicit-label', 'multiple-labels', 'large-input']) {
    const failures = [...result.targetsBelowPlatform, ...result.targetsBelowWcag].filter(target => target.includes(`#${id}.`));
    check(`${id}: usable target retains its full size`, failures.length === 0, failures);
  }

  // Prove the annotation pattern actually accepts keyboard panning in the DOM.
  for (const id of ['named-table', 'named-pre']) {
    await page.locator(`#${id}`).focus();
    await page.keyboard.press('ArrowRight');
    const panned = await page.waitForFunction(target => document.getElementById(target).scrollLeft > 0, id, { timeout: 1500 })
      .then(() => true, () => false);
    check(`${id}: ArrowRight pans the focused region`, panned,
      await page.locator(`#${id}`).evaluate(element => ({ focused: document.activeElement === element, scrollLeft: element.scrollLeft })));
  }
  return { passed: checks.every(item => item.passed), checks, scrollers: result.scrollers, targetsBelowPlatform: result.targetsBelowPlatform, targetsBelowWcag: result.targetsBelowWcag };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const browser = await chromium.launch(mobileBrowserLaunchOptions(chromium));
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const result = await runMobileProbeRegressions(page);
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
