import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  colorDifference,
  composite,
  contrastRatio,
  effectiveRatio,
  floorTo,
  parseColor,
  relativeLuminance,
  requiredRatio,
  simulateColorVision,
  worstColorSeparation,
} from './contrast.mjs';

describe('parseColor', () => {
  it('reads the forms a stylesheet and a browser actually produce', () => {
    assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0, a: 1 });
    assert.deepEqual(parseColor('rgb(16, 21, 31)'), { r: 16, g: 21, b: 31, a: 1 });
    assert.deepEqual(parseColor('rgba(0, 0, 0, 0.5)'), { r: 0, g: 0, b: 0, a: 0.5 });
    assert.equal(parseColor('#ffffff80').a, 128 / 255);
    assert.equal(parseColor('rgb(1 2 3 / 0.25)').a, 0.25);
  });

  it('refuses what is not a colour rather than inventing one', () => {
    assert.equal(parseColor(''), null);
    assert.equal(parseColor(null), null);
    assert.equal(parseColor('transparent'), null);
    assert.equal(parseColor('#12'), null);
    assert.equal(parseColor('#gggggg'), null);
  });
});

describe('contrastRatio', () => {
  it('anchors on the two ratios everyone knows', () => {
    assert.equal(floorTo(contrastRatio(parseColor('#000'), parseColor('#fff'))), 21);
    assert.equal(contrastRatio(parseColor('#777'), parseColor('#777')), 1);
  });

  it('is symmetric', () => {
    const a = parseColor('#10151f');
    const b = parseColor('#f4f6f9');
    assert.equal(contrastRatio(a, b), contrastRatio(b, a));
  });

  it('matches the published luminance of a mid grey', () => {
    // WCAG's own worked example: #767676 on white is the lightest grey that
    // still clears 4.5:1.
    assert.ok(contrastRatio(parseColor('#767676'), parseColor('#ffffff')) >= 4.5);
    assert.ok(contrastRatio(parseColor('#777777'), parseColor('#ffffff')) < 4.5);
  });
});

describe('composite', () => {
  it('leaves an opaque foreground alone', () => {
    const fg = { r: 10, g: 20, b: 30, a: 1 };
    assert.deepEqual(composite(fg, { r: 255, g: 255, b: 255, a: 1 }), { ...fg });
  });

  it('returns the background when the foreground is fully transparent', () => {
    const bg = { r: 244, g: 246, b: 249, a: 1 };
    assert.deepEqual(composite({ r: 0, g: 0, b: 0, a: 0 }, bg), bg);
  });

  it('meets in the middle at half alpha', () => {
    const out = composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
    assert.equal(Math.round(out.r), 128);
  });
});

describe('effectiveRatio', () => {
  it('accounts for the foreground alpha, which is where opacity failures hide', () => {
    // The homepage section labels: near-black text at 57% opacity on the page.
    const faded = effectiveRatio('rgba(16, 21, 31, 0.57)', '#f4f6f9');
    const solid = effectiveRatio('#10151f', '#f4f6f9');
    assert.ok(faded < solid);
    assert.ok(faded < 4.5, 'the faded label must not be reported as passing');
  });

  it('accounts for a plate painted between the ink and the surface', () => {
    // The projected block plate over the palest band of the fee scale.
    const bare = effectiveRatio('#f7f9fc', '#ffb700');
    const plated = effectiveRatio('#f7f9fc', '#ffb700', ['rgba(9, 12, 24, 0.62)']);
    assert.ok(bare < 4.5, 'block ink on the bare fee scale must fail');
    assert.ok(plated >= 4.5, 'the plate is what makes it pass');
  });

  it('reports nothing rather than guessing when a colour will not parse', () => {
    assert.equal(effectiveRatio('not-a-colour', '#fff'), null);
  });
});

describe('requiredRatio', () => {
  it('applies the large-text allowance only where WCAG does', () => {
    assert.equal(requiredRatio({ fontSizePx: 16, fontWeight: 400 }), 4.5);
    assert.equal(requiredRatio({ fontSizePx: 24, fontWeight: 400 }), 3);
    assert.equal(requiredRatio({ fontSizePx: 19, fontWeight: 700 }), 3);
    assert.equal(requiredRatio({ fontSizePx: 19, fontWeight: 400 }), 4.5);
    assert.equal(requiredRatio({ graphical: true }), 3);
  });
});

describe('floorTo', () => {
  it('truncates, so a failing ratio can never round up into a pass', () => {
    assert.equal(floorTo(4.499), 4.49);
    assert.equal(floorTo(4.4999), 4.49);
    assert.equal(floorTo(21), 21);
  });
});

describe('simulateColorVision', () => {
  it('leaves a colour alone for normal vision', () => {
    assert.deepEqual(simulateColorVision('#434ba3', 'normal'), parseColor('#434ba3'));
  });

  it('collapses red and green towards each other for the common deficiencies', () => {
    const red = '#c62828';
    const green = '#2e7d32';
    const normal = colorDifference(red, green);
    const deutan = colorDifference(
      simulateColorVision(red, 'deuteranopia'),
      simulateColorVision(green, 'deuteranopia'),
    );
    assert.ok(deutan < normal, 'red and green must come closer, not further apart');
  });

  it('refuses a deficiency it does not model', () => {
    assert.throws(() => simulateColorVision('#fff', 'nonsense'));
  });
});

describe('worstColorSeparation', () => {
  it('finds the vision type that hides a difference', () => {
    // The pair that sank the hand-picked ramp: plum beside magenta.
    const { difference, kind } = worstColorSeparation('#7a3572', '#a3246b');
    assert.ok(difference < 15, 'these two are not separable and the check must say so');
    assert.notEqual(kind, undefined);
  });

  it('keeps a deliberately separated pair separated', () => {
    const { difference } = worstColorSeparation('#434ba3', '#a3436b');
    assert.ok(difference >= 25, 'the shipped ramp neighbours must stay apart');
  });

  it('reports no separation between a colour and itself', () => {
    assert.equal(floorTo(worstColorSeparation('#434ba3', '#434ba3').difference), 0);
  });
});

describe('relativeLuminance', () => {
  it('spans the full range', () => {
    assert.equal(relativeLuminance(parseColor('#000')), 0);
    assert.equal(floorTo(relativeLuminance(parseColor('#fff'))), 1);
  });
});
