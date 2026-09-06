import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureTextContrast } from './silent-payments-contrast-browser.mjs';

const layer = (backgroundColor, opacity = 1, backgroundImage = 'none') => ({ backgroundColor, opacity, backgroundImage });
test('composites translucent surfaces and group opacity before contrast assessment', () => {
  const measured = measureTextContrast({ color: '#000', fontSizePx: 16, fontWeight: 400,
    layers: [layer('rgba(0, 0, 0, 0)', 0.5), layer('#fff')] });
  assert.equal(measured.effectiveForeground.r, 127.5);
  assert.equal(measured.effectiveBackground.r, 255);
  assert(measured.ratio > 3.9 && measured.ratio < 4);
  assert.equal(measured.passed, false);
  const opaque = measureTextContrast({ color: '#000', fontSizePx: 16, fontWeight: 400,
    layers: [layer('#fff'), layer('#000', 1, 'linear-gradient(black, white)')] });
  assert.equal(opaque.ratio, 21);
});

test('does not manufacture ratios for visible background images or an unresolved canvas', () => {
  assert.throws(() => measureTextContrast({ color: '#000', layers: [layer('#fff', 1, 'linear-gradient(black, white)')] }), /background image/);
  assert.throws(() => measureTextContrast({ color: '#000', layers: [layer('rgba(0, 0, 0, 0)')] }), /canvas/);
});
