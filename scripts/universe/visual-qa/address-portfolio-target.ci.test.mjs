import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';
import { installFixtures, ROUTES } from './capture.mjs';
import { mobileProbe, TOUCH_FLOOR, FIELD_FLOOR } from './mobile-check.mjs';

// A new controlled CI browser only. Never attach to a user/browser session.
assert.ok(!process.env.CDP_URL && !process.env.BROWSER_CDP_URL);
const base = new URL(process.env.UNIVERSE_GATEWAY_BASE);
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.username + base.password + base.search + base.hash, '');
const route = ROUTES.find(r => r.id === 'address');
const engine=process.env.UNIVERSE_BROWSER_ENGINE || 'chromium';
assert.ok(['chromium','firefox'].includes(engine));

test('shipped address portfolio link keeps a touch target at each failed CI viewport', { timeout: 60000 }, async () => {
  const browser = await ({chromium,firefox})[engine].launch({ headless: true });
  const reproducedCrowdedTargets=[];
  try {
    for (const [width, height] of [[320,640],[360,740],[390,844],[430,932],[844,390],[768,1024]]) {
      const context = await browser.newContext({ viewport: {width,height}, ...(engine==='chromium'?{hasTouch:true,isMobile:true}:{}), serviceWorkers:'block' });
      try {
        await installFixtures(context, 'populated');
        const page = await context.newPage();
        await page.goto(new URL(route.path, base).href, {waitUntil:'load'});
        const help=page.locator('app-address .universe-portfolio-link a');
        await help.waitFor({state:'visible',timeout:10000});
        assert.ok((await help.getAttribute('href')).startsWith('/portfolio/bitcoin/mainnet/'));
        const rect=await help.boundingBox();
        assert.ok(rect.height>=44, `${width}x${height} hit target height ${rect.height}`);
        let measured=await page.evaluate(mobileProbe,{touchFloor:TOUCH_FLOOR,fieldFloor:FIELD_FLOOR});
        assert.ok(!measured.targetsBelowWcag.some(x=>x.startsWith('app-address a')), `${width}: ${measured.targetsBelowWcag}`);
        // Restore the exact old inline geometry in this disposable page. The
        // unchanged production gate must detect the original crowded target.
        await page.addStyleTag({content:'app-address .universe-portfolio-link a{display:inline!important;min-height:0!important}'});
        assert.ok((await help.boundingBox()).height<24, `${width}: old inline geometry remains under the minimum`);
        measured=await page.evaluate(mobileProbe,{touchFloor:TOUCH_FLOOR,fieldFloor:FIELD_FLOOR});
        if(measured.targetsBelowWcag.some(x=>x.startsWith('app-address a'))) reproducedCrowdedTargets.push(width);
      } finally { await context.close(); }
    }
    for(const width of [320,360,390,430]) assert.ok(reproducedCrowdedTargets.includes(width), `${engine}: old crowded geometry must fail at ${width}`);
  } finally { await browser.close(); }
});
