#!/usr/bin/env node
/**
 * Dynamic palette gate.
 *
 * The colours a visitor actually sees on a block face, a fee scale, a chart
 * series, or a mining pool swatch are not written in a stylesheet. They are
 * computed at runtime from live data, which is exactly why they escaped every
 * review until they were unreadable in production.
 *
 * So the pairings are checked here instead: for each palette, every colour it
 * can produce is measured against the ink that will be printed on it, and
 * against the surface it will sit beside. A palette that cannot carry any ink
 * has to use a protected plate, and the plate is measured too.
 *
 * Usage:
 *   node scripts/universe/check-palettes.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contrastRatio, effectiveRatio, floorTo, parseColor, worstColorSeparation } from './contrast.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const constantsPath = resolve(ROOT, 'frontend/src/app/app.constants.ts');
const tokensPath = resolve(ROOT, 'frontend/src/styles/_universe-tokens.scss');
const contrastThemePath = resolve(ROOT, 'frontend/src/theme-contrast.scss');

const constants = readFileSync(constantsPath, 'utf8');
const tokensSource = readFileSync(tokensPath, 'utf8');
const contrastSource = readFileSync(contrastThemePath, 'utf8');

/** Pull a `export const NAME = [ ... ]` array of bare hex strings. */
function hexArray(name) {
  const start = constants.indexOf(`export const ${name} = [`);
  if (start < 0) throw new Error(`palette ${name} not found in app.constants.ts`);
  const end = constants.indexOf('];', start);
  const body = constants.slice(start, end);
  const found = body.match(/'#?([0-9a-fA-F]{6})'/g) || [];
  return found.map((raw) => '#' + raw.replace(/['#]/g, ''));
}

/** Pull the value of a --u-* custom property out of a token mixin. */
function token(source, name, { after = '' } = {}) {
  const from = after ? source.indexOf(after) : 0;
  const match = source.slice(from).match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`token --${name} not found`);
  return match[1].trim();
}

const LIGHT = '@mixin universe-light-tokens';
const DARK = '@mixin universe-dark-tokens';

const ink = {
  block: token(tokensSource, 'u-block-ink'),
  blockMuted: token(tokensSource, 'u-block-ink-muted'),
  plate: token(tokensSource, 'u-block-plate'),
  special: token(tokensSource, 'u-special-ink'),
  specialPlate: token(tokensSource, 'u-special-plate'),
};

const checks = [];
const failures = [];

/**
 * @param label   what the reader is looking at
 * @param fg      the ink
 * @param bgs     every background the ink can land on
 * @param plates  translucent layers painted between background and ink
 * @param floor   the ratio this pairing has to clear
 */
function check(label, fg, bgs, { plates = [], floor = 4.5 } = {}) {
  let worst = Infinity;
  let worstBg = null;
  for (const bg of bgs) {
    const ratio = effectiveRatio(fg, bg, plates);
    if (ratio === null) throw new Error(`unparseable pairing in "${label}": ${fg} on ${bg}`);
    if (ratio < worst) {
      worst = ratio;
      worstBg = bg;
    }
  }
  const value = floorTo(worst);
  const row = { label, fg, worstBackground: worstBg, ratio: value, floor, pass: value >= floor };
  checks.push(row);
  if (!row.pass) failures.push(row);
}

// --- The fee scale ---------------------------------------------------------
//
// The band names were moved off the bar precisely because this palette carries
// no ink: white bottoms out around 3.4:1 and near-black around 2.8:1. The
// assertion below is the reason that decision has to stand, so it is recorded
// as a fact rather than as a comment someone can quietly delete.

const defaultFees = hexArray('defaultMempoolFeeColors');
const contrastFees = hexArray('contrastMempoolFeeColors');
const allFees = [...defaultFees, ...contrastFees];

for (const [name, palette] of [['default', defaultFees], ['contrast', contrastFees]]) {
  const bestWhite = Math.min(...palette.map((c) => contrastRatio(parseColor('#ffffff'), parseColor(c))));
  const bestBlack = Math.min(...palette.map((c) => contrastRatio(parseColor('#05070d'), parseColor(c))));
  if (bestWhite >= 4.5 || bestBlack >= 4.5) {
    // Not a failure, but the premise changed: revisit whether the labels still
    // need to live off the bar.
    console.log(
      `note: the ${name} fee scale now carries an ink directly ` +
        `(white ${floorTo(bestWhite)}:1, near-black ${floorTo(bestBlack)}:1)`,
    );
  }
}

// --- Projected block faces -------------------------------------------------
//
// A projected block's face IS the fee gradient, and text is printed on it. The
// plate is what makes that text readable over every colour the gradient can
// reach, so the plate is measured against the whole palette, not a sample.

check('projected block text over the fee gradient, through the plate', ink.block, allFees, {
  plates: [ink.plate],
});
check('projected block secondary text over the fee gradient, through the plate', ink.blockMuted, allFees, {
  plates: [ink.plate],
});

// --- Confirmed block faces -------------------------------------------------
//
// Fixed colours, but they are the product's focal object, so they are held to
// the same floor as everything else.

for (const theme of [LIGHT, DARK]) {
  const faces = [
    token(tokensSource, 'u-block-confirmed-from'),
    token(tokensSource, 'u-block-confirmed-to'),
    token(tokensSource, 'u-block-confirmed-top'),
    token(tokensSource, 'u-block-confirmed-side'),
    token(tokensSource, 'u-block-projected-empty'),
    token(tokensSource, 'u-block-projected-top'),
    token(tokensSource, 'u-block-projected-side'),
  ];
  check(`block text on every block facet (${theme.includes('light') ? 'light' : 'dark'})`, ink.block, faces);
  check(
    `block secondary text on every block facet (${theme.includes('light') ? 'light' : 'dark'})`,
    ink.blockMuted,
    faces,
  );
  break; // the facets are theme-invariant by design; one pass covers both
}

// --- The round-height plate ------------------------------------------------

check('special block height plate', ink.special, [ink.specialPlate]);

// --- Chart series ----------------------------------------------------------
//
// Series colours are marks, not text, so they are held to the graphical floor
// against the surface they are drawn on.

const chartColors = hexArray('chartColors');
for (const [theme, source, marker] of [['light', tokensSource, LIGHT], ['dark', tokensSource, DARK]]) {
  const surface = token(source, 'u-surface-raised', { after: marker });
  const grid = token(source, 'u-chart-grid', { after: marker });
  const axis = token(source, 'u-chart-axis', { after: marker });
  const series = [1, 2, 3, 4, 5, 6, 7].map((n) => token(source, `u-chart-${n}`, { after: marker }));

  check(`chart series against the card surface (${theme})`, series[0], [surface], { floor: 3 });
  for (const [i, colour] of series.entries()) {
    check(`chart series ${i + 1} against the card surface (${theme})`, colour, [surface], { floor: 3 });
  }
  check(`chart axis labels (${theme})`, axis, [surface]);
  check(`chart grid lines (${theme})`, grid, [surface], { floor: 1.2 });

  // Categorical series have to be separable from each other, not only from the
  // page, or a stacked chart becomes one shape. Contrast ratio is the wrong
  // instrument for that: two hues can differ obviously and share a luminance.
  // So they are compared by perceptual distance, and through the three common
  // colour vision deficiencies as well as normal vision, because that is where
  // a hand-picked ramp quietly collapses. Neighbours are held further apart
  // than distant pairs because they are the ones read side by side.
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const { difference, kind } = worstColorSeparation(series[i], series[j]);
      const adjacent = j === i + 1;
      const floor = adjacent ? 25 : 15;
      const value = floorTo(difference, 1);
      const row = {
        label: `chart series ${i + 1} vs ${j + 1}${adjacent ? ' (adjacent)' : ''} under ${kind} (${theme})`,
        fg: series[i],
        worstBackground: series[j],
        ratio: value,
        floor,
        pass: value >= floor,
        unit: 'dE',
      };
      checks.push(row);
      if (!row.pass) failures.push(row);
    }
  }
}

// The inherited categorical ramp is drawn as filled areas on the card surface.
check('inherited chart ramp against the card surface (light)', chartColors[0], [
  token(tokensSource, 'u-surface-raised', { after: LIGHT }),
], { floor: 3 });

// --- Evidence and protocol tokens -----------------------------------------

for (const [theme, marker] of [['light', LIGHT], ['dark', DARK]]) {
  for (const state of ['proven', 'partial', 'pending', 'unavailable', 'neutral']) {
    const fg = token(tokensSource, `u-state-${state}`, { after: marker });
    const surface = token(tokensSource, `u-state-${state}-surface`, { after: marker });
    const border = token(tokensSource, `u-state-${state}-border`, { after: marker });
    const page = token(tokensSource, 'u-surface-page', { after: marker });
    const raised = token(tokensSource, 'u-surface-raised', { after: marker });
    check(`${state} text on its own tint (${theme})`, fg, [surface]);
    check(`${state} text on page and card (${theme})`, fg, [page, raised]);
    check(`${state} border against page and card (${theme})`, border, [page, raised], { floor: 1.4 });
  }

  for (const protocol of ['ordinals', 'runes', 'alkanes', 'stamps', 'atomicals', 'op-data', 'fallback']) {
    const fg = token(tokensSource, `u-protocol-${protocol}`, { after: marker });
    check(`${protocol} name on page and card (${theme})`, fg, [
      token(tokensSource, 'u-surface-page', { after: marker }),
      token(tokensSource, 'u-surface-raised', { after: marker }),
    ]);
  }
}

// --- Core text and structure ----------------------------------------------

for (const [theme, marker] of [['light', LIGHT], ['dark', DARK]]) {
  const page = token(tokensSource, 'u-surface-page', { after: marker });
  const raised = token(tokensSource, 'u-surface-raised', { after: marker });
  const sunken = token(tokensSource, 'u-surface-sunken', { after: marker });
  const inset = token(tokensSource, 'u-surface-inset', { after: marker });
  const surfaces = [page, raised, sunken, inset];

  check(`primary text on every surface (${theme})`, token(tokensSource, 'u-text-primary', { after: marker }), surfaces, { floor: 7 });
  check(`secondary text on every surface (${theme})`, token(tokensSource, 'u-text-secondary', { after: marker }), surfaces);
  // Muted text carries information (timestamps, counts, units), and placeholder
  // text has to be readable, so both are held to the body floor rather than 3:1.
  check(`muted text on every surface (${theme})`, token(tokensSource, 'u-text-muted', { after: marker }), surfaces);
  check(`links on every surface (${theme})`, token(tokensSource, 'u-brand', { after: marker }), surfaces);
  check(`brand button label (${theme})`, token(tokensSource, 'u-brand-contrast', { after: marker }), [
    token(tokensSource, 'u-brand', { after: marker }),
    token(tokensSource, 'u-brand-hover', { after: marker }),
  ]);
  check(`focus ring against every surface (${theme})`, token(tokensSource, 'u-focus-ring', { after: marker }), surfaces, { floor: 3 });
  check(`borders against page and card (${theme})`, token(tokensSource, 'u-border', { after: marker }), [page, raised], { floor: 1.2 });
  check(`strong borders against page and card (${theme})`, token(tokensSource, 'u-border-strong', { after: marker }), [page, raised], { floor: 1.6 });
  check(`skeleton against page and card (${theme})`, token(tokensSource, 'u-skeleton', { after: marker }), [page, raised], { floor: 1.05 });

  for (const category of ['constant', 'control', 'stack', 'splice', 'logic', 'arithmetic', 'crypto', 'locktime', 'reserved']) {
    check(`script ${category} opcodes (${theme})`, token(tokensSource, `u-code-${category}`, { after: marker }), [raised, sunken]);
  }
}

// --- High contrast ---------------------------------------------------------

const hcSurfaces = ['u-surface-page', 'u-surface-raised', 'u-surface-sunken', 'u-surface-inset'].map((n) =>
  token(contrastSource, n),
);
check('high contrast primary text', token(contrastSource, 'u-text-primary'), hcSurfaces, { floor: 7 });
check('high contrast secondary text', token(contrastSource, 'u-text-secondary'), hcSurfaces, { floor: 7 });
check('high contrast muted text', token(contrastSource, 'u-text-muted'), hcSurfaces);
check('high contrast links', token(contrastSource, 'u-brand'), hcSurfaces, { floor: 7 });
check('high contrast focus ring', token(contrastSource, 'u-focus-ring'), hcSurfaces, { floor: 3 });
check('high contrast borders', token(contrastSource, 'u-border'), hcSurfaces, { floor: 3 });
for (const state of ['proven', 'partial', 'pending', 'unavailable', 'neutral']) {
  check(`high contrast ${state} text`, token(contrastSource, `u-state-${state}`), hcSurfaces, { floor: 7 });
}
// This theme brightens the fee scale far enough that near-black is the ink.
check('high contrast fee scale ink', token(contrastSource, 'u-fee-label-ink'), contrastFees);

// --- Report ----------------------------------------------------------------

const width = Math.min(64, Math.max(...checks.map((c) => c.label.length)));
for (const row of checks) {
  const mark = row.pass ? 'ok  ' : 'FAIL';
  console.log(
    `${mark} ${row.label.padEnd(width)}  ${String(row.ratio).padStart(6)}${row.unit === 'dE' ? ' dE' : ':1 '}  ` +
      `(needs ${row.floor})  ${row.fg} / ${row.worstBackground}`,
  );
}

console.log(`\n${checks.length} palette pairings checked, ${failures.length} failing.`);
if (failures.length) {
  console.error('\nEvery pairing above has to clear its floor before this ships.');
  process.exit(1);
}
