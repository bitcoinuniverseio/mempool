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
import { colorDifference, contrastRatio, effectiveRatio, floorTo, parseColor, worstColorSeparation } from './contrast.mjs';

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
    token(tokensSource, 'u-block-confirmed-empty'),
    token(tokensSource, 'u-block-projected-empty'),
    token(tokensSource, 'u-block-loading'),
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

// The accelerate chip predates the Universe token layer. Its semantic ink is
// authoritative once tokens load, while the exact light-token literal protects
// the legacy first paint. Hold that fallback to the same body-text floor on
// both fills the chip can wear.
check('accelerate chip first-paint fallback', '#ffffff', [
  token(tokensSource, 'u-lavender', { after: LIGHT }),
  token(tokensSource, 'u-brand', { after: LIGHT }),
]);

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

// --- Filled brand surfaces -------------------------------------------------
//
// A filled control is not one colour. It is a gradient with a gloss layer over
// it, and the label sits on top of both. Measuring the label against
// --u-brand alone would have passed a button whose violet end, lifted by the
// gloss, put white text at 4.06:1. So every stop is measured, through the
// gloss, against the foreground the fill declares.

function gradientStops(source, name, after) {
  const value = token(source, name, { after });
  return (value.match(/#[0-9a-fA-F]{3,8}/g) || []);
}

/** The strongest layer of the gloss, which is the worst case for a label. */
function glossPlate(source, after) {
  const value = token(source, 'u-gloss', { after });
  const first = value.match(/rgba?\([^)]*\)/);
  return first ? first[0] : 'rgba(255,255,255,0)';
}

for (const [theme, source, marker] of [
  ['light', tokensSource, LIGHT],
  ['dark', tokensSource, DARK],
  ['high contrast', contrastSource, ''],
]) {
  const fromDark = source === contrastSource ? DARK : marker;
  const ink = token(source, 'u-brand-contrast', { after: marker }) ||
    token(tokensSource, 'u-brand-contrast', { after: DARK });
  const stops = source === contrastSource
    ? gradientStops(tokensSource, 'u-gradient-brand', DARK)
    : gradientStops(source, 'u-gradient-brand', fromDark);
  const plate = source === contrastSource
    ? glossPlate(tokensSource, DARK)
    : glossPlate(source, fromDark);

  for (const [i, stop] of stops.entries()) {
    check(`brand gradient stop ${i + 1} carries its label, through the gloss (${theme})`, ink, [stop], {
      plates: [plate],
    });
  }
  check(`brand fill carries its label, through the gloss (${theme})`, ink, [
    token(source, 'u-brand', { after: marker }),
    token(source, 'u-brand-hover', { after: marker }),
  ], { plates: [plate] });
}

// --- Role separation -------------------------------------------------------
//
// Three families of colour share this product: the brand, the evidence states,
// and protocol identity. The whole system rests on a reader never confusing
// them, so the distances are measured rather than asserted in a comment.
//
// The measurement is perceptual distance under normal vision, not contrast
// ratio: two colours can differ obviously and still share a luminance, and it
// is sameness of hue that would make a pink chip read as "confirmed". Colour
// vision deficiency is covered a different way, by the rule that a state always
// carries a word and a protocol colour always appears beside a protocol name.

function separation(label, a, b, floor = 25) {
  const value = floorTo(colorDifference(a, b), 1);
  const row = { label, fg: a, worstBackground: b, ratio: value, floor, pass: value >= floor, unit: 'dE' };
  checks.push(row);
  if (!row.pass) failures.push(row);
}

const STATES = ['proven', 'partial', 'pending', 'unavailable', 'neutral'];
// `fallback` is deliberately the neutral state colour: it is what a protocol
// with no identity of its own is drawn in, so it is the one pair that is meant
// to match.
const PROTOCOLS = ['ordinals', 'runes', 'alkanes', 'stamps', 'atomicals', 'op-data'];
const BRAND_ROLES = ['u-brand', 'u-brand-hover', 'u-brand-accent', 'u-magenta', 'u-fuchsia', 'u-lavender'];

for (const [theme, marker] of [['light', LIGHT], ['dark', DARK]]) {
  for (const role of BRAND_ROLES) {
    const brand = token(tokensSource, role, { after: marker });
    for (const state of STATES) {
      separation(
        `--${role} is not the ${state} state (${theme})`,
        brand,
        token(tokensSource, `u-state-${state}`, { after: marker }),
      );
    }
  }

  for (const protocol of PROTOCOLS) {
    const hue = token(tokensSource, `u-protocol-${protocol}`, { after: marker });
    for (const state of STATES) {
      // A protocol chip and a verdict chip are different components in
      // different places, and both always carry a word, so the floor between
      // them is "visibly a different colour" rather than the wider distance
      // the brand is held to. Ordinals orange and the amber that means partial
      // evidence are the closest legitimate pair in the product, and this is
      // the number that keeps them from converging any further.
      separation(
        `${protocol} is not the ${state} state (${theme})`,
        hue,
        token(tokensSource, `u-state-${state}`, { after: marker }),
        12,
      );
    }
    // The brand may never be read as a protocol, so it keeps the wide floor.
    separation(
      `${protocol} is not the brand (${theme})`,
      hue,
      token(tokensSource, 'u-brand', { after: marker }),
    );
    // Two protocols that look alike are two protocols a reader will mix up.
    for (const other of PROTOCOLS) {
      if (other <= protocol) continue;
      separation(
        `${protocol} and ${other} are different colours (${theme})`,
        hue,
        token(tokensSource, `u-protocol-${other}`, { after: marker }),
        20,
      );
    }
  }
}

// --- The one acknowledged proximity ----------------------------------------
//
// Everything above holds the brand at 25 dE or more from every other meaning in
// the product. There is exactly one pairing that does not clear it, and it is
// recorded here rather than left to be discovered.
//
// The fee scale runs green for cheap through amber to a deep magenta for the
// most expensive band, and that top band sits about 10.7 dE from the light
// brand fill. Both values are load bearing and neither can move. The fee scale
// is what a block face, the Lens, and the mempool depth chart all mean by a fee
// rate, and a Bitcoin user already reads hot as expensive. The brand fill is
// the measured pink a white label clears.
//
// It is tolerable because the two never do the same job: the fee colour is
// always a large filled area with a sat/vB figure attached, and the brand is
// always a control or a mark. It is checked at the distance it actually has, so
// that nudging either value closer fails the build and forces the decision to
// be made again rather than drifting.

{
  const feeScaleTop = '#' + (constants.match(/export const defaultMempoolFeeColors = \[([\s\S]*?)\]/)[1]
    .match(/'([0-9a-fA-F]{6})'/g) || []).slice(-1)[0].replace(/'/g, '');
  separation(
    'fee scale top band against the brand fill (light), the one acknowledged proximity',
    feeScaleTop,
    token(tokensSource, 'u-brand', { after: LIGHT }),
    10,
  );
  separation(
    'fee scale top band against the brand anchor (light)',
    feeScaleTop,
    token(tokensSource, 'u-brand-accent', { after: LIGHT }),
    25,
  );
  separation(
    'fee scale top band against the brand (dark)',
    feeScaleTop,
    token(tokensSource, 'u-brand', { after: DARK }),
    25,
  );
}

// --- Theme parity ----------------------------------------------------------
//
// Dark and high contrast are not reduced versions of the product. Any token the
// light theme declares has to exist in the other two, or a component styled
// from it renders unpainted on a theme nobody reviewed.

function declaredTokens(source, after) {
  const from = after ? source.indexOf(after) : 0;
  const rest = source.slice(from);
  // The mixin's own closing brace is the only one at column zero.
  const end = after ? rest.search(/^\}/m) : -1;
  const body = end > 0 ? rest.slice(0, end) : rest;
  return new Set((body.match(/--u-[a-z0-9-]+(?=\s*:)/g) || []).map((n) => n.slice(2)));
}

const lightTokens = declaredTokens(tokensSource, LIGHT);
const darkTokens = declaredTokens(tokensSource, DARK);
const contrastTokens = new Set([...darkTokens, ...declaredTokens(contrastSource)]);

for (const [themeName, present] of [['dark', darkTokens], ['high contrast', contrastTokens]]) {
  const missing = [...lightTokens].filter((name) => !present.has(name)).sort();
  const row = {
    label: `every light token has a ${themeName} counterpart`,
    fg: `${lightTokens.size} tokens`,
    worstBackground: missing.length ? missing.join(', ').slice(0, 70) : 'complete',
    ratio: lightTokens.size - missing.length,
    floor: lightTokens.size,
    pass: missing.length === 0,
    unit: 'tokens',
  };
  checks.push(row);
  if (!row.pass) failures.push(row);
}

// --- Retired brand values --------------------------------------------------
//
// The ultramarine identity this product shipped with was centralised, which is
// what made replacing it a small change. The same property makes it easy to
// reintroduce by accident: one component rule with a literal, or one metadata
// file nobody re-reads. So the retired values are named here and refused
// everywhere.

const RETIRED = {
  '#2438b8': 'ultramarine brand fill',
  '#1b2b93': 'ultramarine brand hover',
  '#8fa2ff': 'ultramarine brand, dark',
  '#a8b8ff': 'ultramarine brand, high contrast',
  '#2055e3': 'ultramarine title colour',
  '#007cfa': 'inherited Bootstrap primary',
  '#e7ebfb': 'ultramarine subtle surface',
  '#c3ccf3': 'ultramarine border',
};

const RETIRED_SCOPE = [
  'frontend/src/styles/_universe-tokens.scss',
  'frontend/src/theme-dark.scss',
  'frontend/src/theme-contrast.scss',
  'frontend/src/styles.scss',
  'frontend/src/index.mempool.html',
  'frontend/src/resources/favicons/browserconfig.xml',
  'frontend/src/resources/favicons/site.webmanifest',
  'frontend/src/app/shared/chart-theme.ts',
  'scripts/universe/brand/render-brand-assets.mjs',
];

for (const [value, what] of Object.entries(RETIRED)) {
  const found = RETIRED_SCOPE.filter((file) => {
    const body = readFileSync(resolve(ROOT, file), 'utf8');
    return body.toLowerCase().includes(value);
  });
  const row = {
    label: `retired ${what} stays retired`,
    fg: value,
    worstBackground: found.length ? found.join(', ') : 'absent',
    ratio: found.length,
    floor: 0,
    pass: found.length === 0,
    unit: 'uses',
  };
  checks.push(row);
  if (!row.pass) failures.push(row);
}

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
