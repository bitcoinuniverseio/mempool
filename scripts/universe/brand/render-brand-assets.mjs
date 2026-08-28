#!/usr/bin/env node
/**
 * Render the Universe Explorer brand raster assets from their source SVGs.
 *
 * Every favicon and app icon in this repository was byte-identical to the
 * upstream project's, so the browser tab, the bookmark, the home screen icon,
 * and the installed app all still showed someone else's brand. This script is
 * how they are produced, so they can never drift from the mark again: change
 * the SVG, re-run, commit.
 *
 * It also renders the social card. The page previously pointed og:image at an
 * SVG, which no social platform renders, so every shared link previewed blank.
 *
 * Usage:  node scripts/universe/brand/render-brand-assets.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as playwright from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const RESOURCES = join(ROOT, 'frontend', 'src', 'resources');
const FAVICONS = join(RESOURCES, 'favicons');
const UNIVERSE = join(RESOURCES, 'universe');

// Taken from the light palette in styles/_universe-tokens.scss. Icons are
// rendered once and served to every theme, so they carry the brand colour on an
// opaque ground rather than trying to adapt.
//
// The icon is inverted on purpose: a pearl mark on a hot-pink tile, rather than
// a pink glyph on white. Every explorer in this market ships a dark or white
// favicon, so a solid pink tile is the one that can be found in a strip of
// twenty tabs. Pearl on #c40059 measures 5.7:1, so the mark stays legible at
// 16px rather than relying on the tile colour alone.
const BRAND = '#c40059';
const BRAND_ACCENT = '#ff0066';
const MAGENTA = '#a3006b';
const FUCHSIA = '#8b2fb5';
const INK = '#241a2b';
const PEARL = '#fff6fa';
const MUTED = '#645a6e';

const mark = readFileSync(join(UNIVERSE, 'universe-mark.svg'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .trim();

/** The mark at a given size, in a given colour, on a given ground. */
function iconPage(size, color, background, padding) {
  const inner = size - padding * 2;
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  body{width:${size}px;height:${size}px;background:${background};
       display:flex;align-items:center;justify-content:center}
  .m{width:${inner}px;height:${inner}px;color:${color};display:block}
  svg{width:100%;height:100%;display:block}
</style>
<div class="m">${mark}</div>`;
}

/**
 * The social card.
 *
 * 1200x630 is what every platform crops to. It states the product name and the
 * promise, and nothing it cannot back up.
 */
function socialCard() {
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0}
  body{width:1200px;height:630px;background:${PEARL};
       font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
       display:flex;flex-direction:column;justify-content:center;
       padding:0 96px;box-sizing:border-box}
  .rule{height:6px;width:180px;margin-bottom:44px;
        background:linear-gradient(90deg,${BRAND_ACCENT} 0%,${MAGENTA} 52%,${FUCHSIA} 100%)}
  .mark{width:76px;height:76px;color:${BRAND};margin-bottom:34px}
  .mark svg{width:100%;height:100%;display:block}
  h1{font-size:76px;line-height:1.03;letter-spacing:-0.025em;
     color:${INK};margin:0 0 26px;font-weight:700}
  p{font-size:32px;line-height:1.38;color:${MUTED};margin:0;max-width:36ch}
  .foot{position:absolute;bottom:52px;left:96px;font-size:22px;
        color:${MUTED};letter-spacing:0.04em}
</style>
<div class="rule"></div>
<div class="mark">${mark}</div>
<h1>Universe&nbsp;Explorer</h1>
<p>Bitcoin activity while it is still forming, and what it proves.</p>
<div class="foot">explorer.bitcoinuniverse.io</div>`;
}

const ICONS = [
  { file: join(FAVICONS, 'favicon-16x16.png'), size: 16, pad: 1 },
  { file: join(FAVICONS, 'favicon-32x32.png'), size: 32, pad: 2 },
  { file: join(FAVICONS, 'apple-touch-icon.png'), size: 180, pad: 26 },
  { file: join(FAVICONS, 'android-chrome-192x192.png'), size: 192, pad: 28 },
  { file: join(FAVICONS, 'android-chrome-512x512.png'), size: 512, pad: 74 },
  { file: join(FAVICONS, 'mstile-150x150.png'), size: 150, pad: 22 },
];

async function main() {
  mkdirSync(FAVICONS, { recursive: true });
  const browser = await playwright.chromium.launch();

  for (const icon of ICONS) {
    const page = await browser.newPage({
      viewport: { width: icon.size, height: icon.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(iconPage(icon.size, PEARL, BRAND, icon.pad));
    await page.screenshot({ path: icon.file, omitBackground: false });
    await page.close();
    console.log(`icon  ${icon.size.toString().padStart(3)}px  ${icon.file}`);
  }

  const card = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await card.setContent(socialCard());
  const cardFile = join(UNIVERSE, 'universe-explorer-social.png');
  await card.screenshot({ path: cardFile });
  await card.close();
  console.log(`card  1200x630  ${cardFile}`);

  await browser.close();

  // favicon.ico, built around the 32px PNG.
  //
  // The ICO container has allowed an embedded PNG since Vista, and every
  // browser that still asks for a .ico understands one. That keeps this file
  // generated from the same mark as everything else rather than being the
  // one asset left carrying the old brand.
  const png = readFileSync(join(FAVICONS, 'favicon-32x32.png'));
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);        // reserved
  header.writeUInt16LE(1, 2);        // type: icon
  header.writeUInt16LE(1, 4);        // one image
  header.writeUInt8(32, 6);          // width
  header.writeUInt8(32, 7);          // height
  header.writeUInt8(0, 8);           // palette size: not paletted
  header.writeUInt8(0, 9);           // reserved
  header.writeUInt16LE(1, 10);       // colour planes
  header.writeUInt16LE(32, 12);      // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);      // offset to the image data
  writeFileSync(join(FAVICONS, 'favicon.ico'), Buffer.concat([header, png]));
  console.log('ico   favicon.ico');

  // A monochrome mark for contexts that will not take a colour, such as a
  // pinned tab or a stencil.
  writeFileSync(
    join(UNIVERSE, 'universe-mark-mono.svg'),
    mark.replace(/currentColor/g, '#000000'),
  );
  console.log('mono  universe-mark-mono.svg');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
