#!/usr/bin/env node
/**
 * The mobile gate.
 *
 * The visual matrix beside this one takes screenshots and reads contrast, and
 * it is good at what a page looks like. It is close to blind to what a page is
 * like to use with a thumb, because almost nothing it measures changes when a
 * control is 38 pixels tall instead of 44, when a field zooms the whole page in
 * on focus, or when the last row of a page sits underneath a fixed bar. Every
 * one of those shipped.
 *
 * So this gate measures the phone, not the picture. It is deliberately built
 * the other way round from the matrix: few page loads, many assertions on each.
 * A page load costs seconds and an assertion costs a millisecond, and the
 * matrix is already the expensive half of the frontend job, so growing coverage
 * here has to be nearly free or it will not be allowed to grow.
 *
 * What it holds the product to, in the order the checks run:
 *
 *   overflow        no page-level sideways scroll at any tested width, and the
 *                   only regions that scroll sideways are ones that say so
 *   fields          no focusable field computes under 16px, which is the
 *                   threshold at which iOS Safari zooms the page and stays
 *                   zoomed
 *   targets         repeated and primary controls clear the 44px floor
 *   fixed layers    nothing the page ends with is underneath the bottom bar,
 *                   and no focused control lands behind either fixed layer
 *   safe areas      the header and the bottom bar pad for a real cutout rather
 *                   than assuming zero
 *   surfaces        an open menu fits the window it is opened in
 *   continuity      rotating the device keeps the route, the query and the
 *                   scroll position
 *
 * Usage:
 *   node mobile-check.mjs --base=http://127.0.0.1:8080
 *   node mobile-check.mjs --base=... --routes=home,tx --viewports=phone-320
 */
import { chromium, devices, firefox, webkit } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { ROUTES, installFixtures } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const BASE = args.base || 'http://localhost:4200';
const OUT = resolve(args.out || join(HERE, 'artifacts-mobile'));
const ENGINES = { chromium, webkit, firefox };
const ENGINE_NAME = args.browser || 'chromium';
const BROWSER = ENGINES[ENGINE_NAME];
if (!BROWSER) {
  throw new Error(`unknown browser "${ENGINE_NAME}"; expected one of ${Object.keys(ENGINES).join(', ')}`);
}

/**
 * Whether this engine can be asked to pretend it is a phone.
 *
 * Chromium and WebKit both take `isMobile`, and it is what makes them report a
 * coarse pointer, which is the whole reason the flag is set. Firefox rejects
 * the option outright rather than ignoring it.
 *
 * That makes Firefox a narrower run rather than a broken one: the window sizes,
 * the overflow, the fixed layers, the safe areas and the rotation are all still
 * measured, and the pointer-conditional rules are not. Which is the honest
 * shape of a Firefox mobile check from a desktop harness, and it is stated in
 * the run's own header rather than left for a reader to assume.
 */
const CAN_EMULATE_MOBILE = ENGINE_NAME !== 'firefox';

/**
 * The window sizes that change the answer, not the phones that are popular.
 *
 * A device name is a poor test variable: two phones with the same CSS viewport
 * render identically, and one phone renders four different sizes depending on
 * its browser chrome, its orientation and whether it is sharing the screen. So
 * these are chosen for the layout decisions they sit either side of.
 *
 *   320   the narrowest width still in use, and the one every reflow rule is
 *         written against
 *   360   the most common Android width
 *   390   the most common iPhone width
 *   430   the widest phone, where a two-column compact layout starts to pay
 *   844   a phone on its side: a compact width with almost no height, which is
 *         the state that breaks a header and a bottom bar at the same time
 *   768   the tablet width where the shell is still in its compact form
 *   1024  the first width above the shell breakpoint, kept as the control: a
 *         mobile fix that regresses the desktop shell fails here
 *
 * `insets` asks the browser to report a display cutout. Chromium has no device
 * to take them from, so they are injected as a style rule that overrides the
 * four safe-area custom properties. That measures the thing that actually
 * matters, which is whether the layout reserves room when the numbers are not
 * zero, rather than whether env() works.
 */
const VIEWPORTS = [
  { id: 'phone-320', width: 320, height: 568, compact: true },
  { id: 'phone-360', width: 360, height: 740, compact: true },
  { id: 'phone-390', width: 390, height: 844, compact: true, insets: { top: 59, bottom: 34, left: 0, right: 0 } },
  { id: 'phone-430', width: 430, height: 932, compact: true },
  { id: 'phone-landscape', width: 844, height: 390, compact: true, landscape: true, insets: { top: 0, bottom: 21, left: 59, right: 59 } },
  { id: 'tablet-768', width: 768, height: 1024, compact: true },
  { id: 'desktop-1024', width: 1024, height: 900, compact: false },
];

/**
 * The touch-target floor, in CSS pixels.
 *
 * WCAG 2.2 AA asks for 24. Apple asks for 44 points and Android for 48 dp, and
 * those are the numbers written for a thumb rather than for a mouse. 44 is the
 * floor here because it is the smaller of the two platform numbers and this
 * gate should fail on things both platforms would call too small, not on the
 * gap between them.
 */
const TOUCH_FLOOR = 44;

/**
 * The smallest a focusable text field may compute to.
 *
 * Not a preference. Below this, iOS Safari zooms the layout viewport in when
 * the field takes focus, and does not zoom back out when it loses it, so the
 * visitor is left panning a page twice as wide as their screen. 16px is where
 * the engine stops doing it.
 */
const FIELD_FLOOR = 16;

/**
 * Every route, walked with a thumb.
 *
 * This used to be a chosen fifteen, on the argument that a page load costs
 * seconds and the shell checks catch most faults anyway. The argument was
 * wrong, and the way it was wrong is worth writing down: running the same
 * checks over the other twenty-nine routes found thirty-six failures on the
 * first pass. Protocol tabs at 31px on seven routes, a select that zoomed an
 * iPhone in on the saved page, an output page with overlapping targets, a
 * replacement timeline scrolling sideways with nothing to say so. None of them
 * were shell faults, and none of them could have been found by a list that did
 * not include the page they were on.
 *
 * A gate that measures the pages someone thought to list measures the author's
 * expectations. The cost is real, so it is paid where it buys something: see
 * FULL_SWEEP_ROUTE_IDS below.
 */
const MOBILE_ROUTE_IDS = args.routes ? String(args.routes).split(',') : ROUTES.map((r) => r.id);

/**
 * The routes that take every window size rather than the narrow three.
 *
 * Seven windows on forty-four routes is three hundred page loads, which is a
 * gate nobody will wait for. Two tiers instead:
 *
 *  * Every route is measured at 320, at 390 and in landscape. Those are the
 *    three that change the answer: the narrowest phone still in use, an
 *    ordinary modern one with a cutout, and the rotation where the bar and the
 *    header are both fighting for the same 390 pixels of height.
 *
 *  * The routes below add 360, 430, the tablet and the desktop control. They
 *    are one of each thing the product is made of, so a breakpoint that goes
 *    wrong between the phone widths, or a wide layout regressed by a mobile
 *    fix, is still caught by something.
 */
const FULL_SWEEP_ROUTE_IDS = new Set([
  'home', 'tx', 'address', 'blocks', 'block', 'graphs', 'protocols',
  'dogecoin-tx', 'zcash-block', 'docs', 'chain-menu',
  'dogecoin', 'zcash-mining', 'dogecoin-graphs', 'zcash-docs',
]);

/** The three window sizes every route is held to. */
const NARROW_VIEWPORT_IDS = new Set(['phone-320', 'phone-390', 'phone-landscape']);

const findings = [];
const passes = [];
/** Focus landing partly under a fixed layer: the AAA rule, reported not gated. */
const grazes = [];

function fail(scope, message) {
  findings.push(`${scope}: ${message}`);
}

function pass(scope, message) {
  passes.push(`${scope}: ${message}`);
}

/**
 * Everything measured inside the page, in one pass.
 *
 * One evaluate rather than a dozen: each round trip to the browser costs more
 * than all of the arithmetic in here put together, and a single snapshot also
 * means every number describes the same moment. Two probes taken either side of
 * a live update can contradict each other and send the reader looking for a
 * bug that is really a race in the harness.
 */
async function mobileProbe(floors) {
  const { touchFloor, fieldFloor } = floors;
  const doc = document.documentElement;
  const round = (n) => Math.round(n * 100) / 100;

  // A name a reader can act on.
  //
  // Half of what this gate finds is an element with no id and no class, and
  // "a@228x24" tells nobody which anchor on a page of two hundred. Angular's
  // component tag is the useful part, because it names the file to open, so the
  // nearest one is walked up to and prefixed. The `ng-` bookkeeping classes are
  // dropped for the same reason: they change on every build and identify
  // nothing.
  const describe = (el) => {
    if (!el) return '(none)';
    const id = el.id ? `#${el.id}` : '';
    const classes = typeof el.className === 'string' && el.className
      ? el.className.trim().split(/\s+/).filter((c) => !c.startsWith('ng-')).slice(0, 3)
      : [];
    const cls = classes.length ? `.${classes.join('.')}` : '';
    let host = el.parentElement;
    while (host && !host.tagName.startsWith('APP-')) host = host.parentElement;
    const owner = host ? `${host.tagName.toLowerCase()} ` : '';
    return `${owner}${el.tagName.toLowerCase()}${id}${cls}`;
  };

  // --- Sideways overflow ---------------------------------------------------
  //
  // The page-level number first, then the elements responsible for it. A gate
  // that reports "the page is 40px too wide" and stops has told the reader
  // that there is a problem and nothing about where it is, which on a page of
  // two thousand elements is most of the work left undone.
  const overflowBy = doc.scrollWidth - doc.clientWidth;
  const viewportWidth = doc.clientWidth;
  const culprits = [];
  if (overflowBy > 0) {
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // Only the elements that actually reach past the right edge, and only
      // the outermost of them: a wide table makes every cell inside it look
      // guilty, and naming the cells buries the table.
      if (rect.right <= viewportWidth + 1) continue;
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > viewportWidth + 1) continue;
      culprits.push(`${describe(el)} reaches ${round(rect.right)} of ${viewportWidth}`);
      if (culprits.length >= 8) break;
    }
  }

  // Regions that scroll sideways on purpose. A wide table of figures is a
  // legitimate thing to pan, and turning every one of them into a stack of
  // cards would destroy the comparison they exist for. What is not legitimate
  // is an element that scrolls sideways without saying so, because a clipped
  // row with no affordance is content that is present and unreachable.
  const scrollers = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.scrollWidth - el.clientWidth <= 1) continue;
    const style = getComputedStyle(el);
    if (style.overflowX !== 'auto' && style.overflowX !== 'scroll') continue;
    scrollers.push({
      el: describe(el),
      // Declared either by a scrollbar the platform paints, by the product's
      // own affordance class, or by a role that says it is a scrollable
      // region to a screen reader.
      declared: Boolean(
        el.closest('[data-scroll-region]')
        || el.matches('.nav-list')
        || el.getAttribute('tabindex') !== null
        || el.getAttribute('role') === 'region',
      ),
      keyboardReachable: el.getAttribute('tabindex') !== null
        || Boolean(el.querySelector('a, button, input, select, textarea, [tabindex]')),
    });
  }

  // Content cut off sideways with no way to reach it.
  //
  // The sibling check above finds a box that scrolls without saying so. This
  // one finds the worse case: a box that does not scroll at all. `overflow-x:
  // hidden` and `clip` both cut the excess away and leave no scrollbar, no
  // drag, and no keyboard route to it, so the page looks finished and part of
  // it is simply gone.
  //
  // Nothing else in this gate could see it. The page-level overflow check
  // reads the document, and the document does not widen when an ancestor
  // clips: `.page-shell` carries `overflow: clip`, so a table 120px too wide
  // for a phone was silently trimmed and every check here passed. That is how
  // the block page lost its miner, the source page lost 384px of licence
  // text, and the address page lost the right-hand half of every address.
  //
  // Two exclusions, both about telling a fault from a technique:
  //
  //  * A box narrower than 40px is the visually-hidden pattern, which clips a
  //    label on purpose so a screen reader keeps it and the screen does not.
  //  * `text-overflow: ellipsis` is deliberate truncation. It says so on the
  //    screen, with the ellipsis, and the full value is on the page it links
  //    to. Cutting a hash short is not the same as cutting a column off.
  //  * `app-truncate` is the same argument one component along. It shortens an
  //    identifier on purpose, shows the head and the tail of it, links to the
  //    page that carries the whole thing, and keeps a hidden full copy inside
  //    itself so a selection copies the real value. Every part of that reads
  //    as clipping from the outside, on every route that prints an identifier.
  //    So the overflow has to be attributed rather than counted: a box is at
  //    fault only when something outside the deliberate machinery is what
  //    sticks out of it.
  const clippers = [];
  for (const el of document.querySelectorAll('body *')) {
    const hidden = el.scrollWidth - el.clientWidth;
    if (hidden <= 2) continue;
    if (el.clientWidth < 40) continue;
    const style = getComputedStyle(el);
    if (style.overflowX !== 'hidden' && style.overflowX !== 'clip') continue;
    if (style.textOverflow === 'ellipsis') continue;
    if (el.closest('app-truncate, [data-clip-ok]')) continue;
    //
    // A wrapper around a deliberate truncation is deliberate too. The link in
    // a dashboard table cell holds one `app-truncate` and nothing else, so its
    // box is the truncation's box and blaming it says the same thing twice.
    const deliberate = (node) => {
      if (node.closest('app-truncate, [data-clip-ok]')) return true;
      const children = Array.from(node.children);
      return children.length > 0
        && children.every((c) => c.matches('app-truncate, [data-clip-ok]'));
    };
    const edge = el.getBoundingClientRect().right;
    let blamed = null;
    for (const child of el.querySelectorAll('*')) {
      if (deliberate(child)) continue;
      const rect = child.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > edge + 2) { blamed = child; break; }
    }
    if (!blamed) continue;
    clippers.push(
      `${describe(el)} hides ${round(hidden)}px of its content sideways with no way to reach it`
      + ` (${describe(blamed)} reaches past its edge)`,
    );
    if (clippers.length >= 6) break;
  }

  // --- Fields that open a keyboard ----------------------------------------
  const smallFields = [];
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select')) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < fieldFloor) {
      smallFields.push(`${describe(el)} computes ${round(size)}px`);
    }
  }

  // --- Touch targets -------------------------------------------------------
  //
  // Measured on what is painted, not on what the stylesheet asks for, so a
  // control shrunk by its container is caught the same as one declared too
  // small. Anything invisible, off-canvas or inside a closed menu is skipped:
  // it is not a target until it can be hit.
  //
  // Two tiers, because there are two different rules and collapsing them gives
  // the wrong answer in both directions.
  //
  // The first is WCAG 2.2 AA target size, which is 24 by 24 with a spacing
  // exception: an undersized target still passes if nothing else is within a
  // 24px circle centred on it. That exception is not a loophole, it is the
  // substance of the rule. What makes a small target unusable is hitting the
  // wrong one, and an isolated small link with nothing near it is not that.
  // Enforcing 24 without the exception would demand that every figure in a
  // dense financial table be spaced like a button, which would destroy the
  // comparison the table exists for.
  //
  // The second is the platform floor of 44, which Apple and Android both ask
  // for, and it is applied to the controls a thumb reaches for repeatedly or
  // under pressure: everything in the application shell, everything in
  // pagination, and anything appearing three or more times identically, which
  // is what a repeated control looks like from here.
  const targetsBelowWcag = [];
  const targetsBelowPlatform = [];
  const seenTargets = new Set();

  const candidates = Array.from(
    document.querySelectorAll('a[href], button, [role=button], input[type=checkbox], input[type=radio], summary'),
  ).filter((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight * 4) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  });

  // How many times each control shape appears. A signature is the tag and its
  // classes, which is what makes one row of a list look like every other row.
  const signatures = new Map();
  const signatureOf = (el) => `${el.tagName}.${typeof el.className === 'string' ? el.className.trim() : ''}`;
  for (const el of candidates) {
    const s = signatureOf(el);
    signatures.set(s, (signatures.get(s) || 0) + 1);
  }

  const boxes = candidates.map((el) => ({ el, rect: el.getBoundingClientRect() }));

  for (const { el, rect } of boxes) {
    const min = Math.min(rect.width, rect.height);

    // Inline links inside running text are exempt, and deliberately so: WCAG
    // 2.2 exempts them because enlarging a word inside a sentence would break
    // the sentence, and the same word is reachable by keyboard and by the
    // browser's own link controls. Only for a link whose parent really is a
    // run of text longer than the link itself.
    const parent = el.parentElement;
    const inSentence = el.tagName === 'A' && parent
      && /^(P|LI|TD|SPAN|DIV|H1|H2|H3|H4|H5|H6)$/.test(parent.tagName)
      && (parent.textContent || '').trim().length > (el.textContent || '').trim().length + 12;
    if (inSentence) continue;

    // A checkbox inside its own label is as large as the label, because
    // pressing the words activates it. Measuring the 18px box and calling it
    // too small describes markup rather than the target, and the fix it asks
    // for, a giant checkbox beside its text, is worse than what is there.
    const label = el.closest('label');
    const effective = label && (el.type === 'checkbox' || el.type === 'radio')
      ? (() => { const lr = label.getBoundingClientRect(); return Math.min(lr.width, lr.height); })()
      : min;

    const key = `${describe(el)}@${round(rect.width)}x${round(rect.height)}`;

    // Tier one. Under 24 and crowded, which is the combination the rule is
    // about.
    if (effective < 24) {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const crowded = boxes.some(({ el: other, rect: o }) => {
        if (other === el || el.contains(other) || other.contains(el)) return false;
        // Closest point of the other target to this one's centre, against the
        // 12px radius of a 24px circle.
        const dx = Math.max(o.left - cx, 0, cx - o.right);
        const dy = Math.max(o.top - cy, 0, cy - o.bottom);
        return Math.hypot(dx, dy) < 12;
      });
      if (crowded && !seenTargets.has(`wcag:${key}`)) {
        seenTargets.add(`wcag:${key}`);
        targetsBelowWcag.push(key);
      }
      continue;
    }

    // Tier two.
    if (effective >= touchFloor) continue;
    const isShell = Boolean(el.closest('.site-header, .primary-nav, .pagination, app-search-form, .chain-menu'));
    const isRepeated = (signatures.get(signatureOf(el)) || 0) >= 3;
    if (!isShell && !isRepeated) continue;
    if (seenTargets.has(`platform:${key}`)) continue;
    seenTargets.add(`platform:${key}`);
    targetsBelowPlatform.push(`${key}${isShell ? ' (shell)' : ' (repeated)'}`);
  }

  // --- What the fixed layers cover ----------------------------------------
  const bar = document.querySelector('.primary-nav');
  const barRect = bar ? bar.getBoundingClientRect() : null;
  const barIsFixed = bar ? getComputedStyle(bar).position === 'fixed' : false;
  const header = document.querySelector('.site-header');
  const headerRect = header ? header.getBoundingClientRect() : null;

  // The last thing on the page has to be reachable. Scroll to the bottom and
  // ask whether the final piece of real content is above the bar or behind it.
  // This is the check that "padding-bottom: 68px" was silently failing on a
  // phone with a home indicator, where the bar is taller than the number.
  //
  // Settling matters here more than anywhere else in this probe. Scrolling to
  // the bottom is what makes a page load whatever it was deferring until it
  // was scrolled to, and an image without dimensions finishes arriving at
  // about the same moment. Measuring straight after the scroll measures the
  // page mid-layout: the bottom moves underneath the measurement, and the
  // answer depends on how fast the machine is. That produced a finding on a
  // Linux runner that no amount of looking could reproduce on a faster
  // workstation, which is the signature of a race rather than a defect.
  //
  // So: scroll, let the page finish, scroll again in case finishing moved the
  // bottom, and only then measure.
  for (let settle = 0; settle < 3; settle++) {
    const before = document.body.scrollHeight;
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((done) => setTimeout(done, 220));
    if (document.body.scrollHeight === before) break;
  }
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const atBottom = { hidden: [], barTop: barIsFixed && barRect ? round(barRect.top) : null };
  if (barIsFixed && barRect) {
    const candidates = document.querySelectorAll('main a[href], main button, main td, main p, main h2, main h3');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      if (rect.height === 0 || rect.width === 0) continue;
      if (rect.top >= window.innerHeight || rect.bottom <= 0) continue;
      // More than a hairline of it under the bar. A one-pixel overlap is a
      // rounding artefact, not content nobody can read.
      if (rect.bottom > barRect.top + 2 && rect.top < barRect.top) {
        // Say which kind it is. A flow element under the bar means the page
        // reserved too little room; a pinned one means something is positioned
        // over the bar and the reservation was never going to reach it. Those
        // are different faults with different fixes, and the message used to
        // leave a reader to work out which by hand.
        let anc = el;
        let pinned = null;
        while (anc && anc !== document.body) {
          const pos = getComputedStyle(anc).position;
          if (pos === 'fixed' || pos === 'sticky') { pinned = `${describe(anc)} is ${pos}`; break; }
          anc = anc.parentElement;
        }
        atBottom.hidden.push(
          `${describe(el)} runs ${round(rect.bottom - barRect.top)}px under the bar`
          + (pinned ? ` (pinned: ${pinned})` : ' (in flow)'),
        );
        if (atBottom.hidden.length >= 6) break;
      }
    }
  }
  window.scrollTo(0, 0);

  // --- Safe areas ----------------------------------------------------------
  //
  // Read as computed padding rather than as the presence of an env() in the
  // stylesheet. A rule that mentions env() and is then overridden by a later
  // one still mentions env(); what matters is whether the painted element
  // actually reserved the room.
  const insets = {
    top: getComputedStyle(doc).getPropertyValue('--u-safe-top').trim(),
    bottom: getComputedStyle(doc).getPropertyValue('--u-safe-bottom').trim(),
    left: getComputedStyle(doc).getPropertyValue('--u-safe-left').trim(),
    right: getComputedStyle(doc).getPropertyValue('--u-safe-right').trim(),
  };
  const chrome = {
    headerPadTop: header ? round(parseFloat(getComputedStyle(header).paddingTop)) : null,
    barPadBottom: bar ? round(parseFloat(getComputedStyle(bar).paddingBottom)) : null,
    barPadLeft: bar ? round(parseFloat(getComputedStyle(bar).paddingLeft)) : null,
    barPadRight: bar ? round(parseFloat(getComputedStyle(bar).paddingRight)) : null,
    headerBottom: headerRect ? round(headerRect.bottom) : null,
  };

  // --- Open surfaces -------------------------------------------------------
  //
  // A menu that is taller than the window is a menu whose last option cannot
  // be chosen, because a positioned surface does not scroll with the page.
  const overflowingSurfaces = [];
  for (const el of document.querySelectorAll('.dropdown-menu.show, .dropdown-menu[style*="transform"], [role=dialog], [role=listbox]')) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0) continue;
    const style = getComputedStyle(el);
    const scrolls = style.overflowY === 'auto' || style.overflowY === 'scroll';
    if (rect.height > window.innerHeight && !scrolls) {
      overflowingSurfaces.push(`${describe(el)} is ${round(rect.height)}px tall in a ${window.innerHeight}px window and does not scroll`);
    }
    if (rect.bottom > window.innerHeight + 1 && !scrolls) {
      overflowingSurfaces.push(`${describe(el)} ends ${round(rect.bottom - window.innerHeight)}px below the window`);
    }
    if (rect.right > viewportWidth + 1 || rect.left < -1) {
      overflowingSurfaces.push(`${describe(el)} runs outside the window sideways`);
    }
  }

  // --- The bottom bar's own state -----------------------------------------
  const navList = document.querySelector('.nav-list');
  const nav = navList
    ? {
        scrolls: navList.scrollWidth - navList.clientWidth > 1,
        scrollLeft: round(navList.scrollLeft),
        // Where the current destination sits inside the scroller. A bar
        // scrolled to its left end while the active destination is off the
        // right edge is a bar that disagrees with the page about where the
        // visitor is.
        activeVisible: (() => {
          const active = navList.querySelector('.nav-item.active');
          if (!active) return null;
          const a = active.getBoundingClientRect();
          const l = navList.getBoundingClientRect();
          return a.left >= l.left - 1 && a.right <= l.right + 1;
        })(),
        hasActive: Boolean(navList.querySelector('.nav-item.active')),
        // The scroll affordance. Painted as background layers rather than as
        // an element, so it is read off the computed style.
        affordance: getComputedStyle(navList).backgroundImage !== 'none',
      }
    : null;

  return {
    overflowBy, viewportWidth, culprits, scrollers, clippers, smallFields,
    targetsBelowWcag, targetsBelowPlatform,
    atBottom, insets, chrome, overflowingSurfaces, nav,
    innerHeight: window.innerHeight,
    docHeight: document.body.scrollHeight,
  };
}

/**
 * Where the focus ring ends up.
 *
 * Run separately from the snapshot above because it has to move focus, and
 * moving focus changes the page.
 *
 * Two outcomes, because WCAG 2.2 draws the line in two places and this product
 * is held to the AA one. `hidden` is a focused control resting entirely behind
 * a fixed layer, which is SC 2.4.11 Focus Not Obscured (Minimum), an AA
 * failure, and in use is worse than the rule sounds: the visitor has no way to
 * tell that anything happened at all. That is what fails a run, on every
 * engine. It is also what this found in the first place, on every phone width,
 * where tabbing near the bottom of a page put the link exactly behind the bar.
 *
 * `grazed` is a control that is partly visible and partly under a layer. That
 * is the AAA rule, SC 2.4.12, and the stylesheet aims for it: `scroll-padding`
 * on the scroller and `scroll-margin` on the targets together place a focused
 * control clear of both layers. Chromium and WebKit honour that and report
 * none. Firefox does not re-scroll an element that is already partly in view,
 * so it reports some, and its own behaviour is compliant with the level this
 * product is held to. So they are counted and printed every run and do not
 * fail it, rather than being dropped, which would leave nobody able to see the
 * difference between the engines at all.
 */
async function focusWalk(page, steps) {
  return page.evaluate(async (limit) => {
    const round = (n) => Math.round(n * 100) / 100;
    const header = document.querySelector('.site-header');
    const bar = document.querySelector('.primary-nav');
    const barFixed = bar && getComputedStyle(bar).position === 'fixed';
    const headerSticky = header && ['sticky', 'fixed'].includes(getComputedStyle(header).position);
    const hidden = [];
    const grazed = [];
    const focusables = Array.from(
      document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      // A control inside the header is not obscured by the header, and a
      // destination inside the bottom bar is not obscured by the bottom bar.
      // Measuring them against the layer they are part of reported the search
      // field as hidden behind the search field's own header, which is both
      // false and loud enough to bury the real findings underneath it.
      if (header && header.contains(el)) return false;
      if (bar && bar.contains(el)) return false;
      return true;
    }).slice(0, limit);

    for (const el of focusables) {
      el.focus({ preventScroll: false });
      if (document.activeElement !== el) continue;
      // Give the browser its own scroll-into-view a frame to happen, which is
      // the behaviour scroll-padding modifies and therefore the behaviour
      // being tested.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) continue;
      const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`;
      const headerBottom = headerSticky ? header.getBoundingClientRect().bottom : 0;
      const barTop = barFixed ? bar.getBoundingClientRect().top : window.innerHeight;
      // The room a focused thing can be scrolled into. An element taller than
      // this cannot avoid touching a layer no matter where it is scrolled to,
      // and WCAG 2.2 AA asks that the focused element not be entirely hidden,
      // not that it never touch anything. Failing a tall panel for overlapping
      // by fifty pixels describes arithmetic rather than a problem, and it
      // would bury the case the rule is about: a small control resting wholly
      // behind the bar, which is what this found on every phone width.
      const room = barTop - headerBottom;
      const fits = rect.height <= room;

      if (barFixed) {
        const b = bar.getBoundingClientRect();
        if (rect.top >= b.top - 2) {
          hidden.push(`${name} rests entirely behind the bottom bar`);
          continue;
        }
        // The second bound matters: an element scrolled entirely below the bar
        // is off screen, not obscured by it, and reporting it as overlapping
        // describes where the page is scrolled rather than anything about the
        // layer.
        if (fits && rect.bottom > b.top + 2 && rect.top < b.bottom) {
          grazed.push(`${name} overlaps the bottom bar by ${round(rect.bottom - b.top)}px`);
          continue;
        }
      }
      if (headerSticky) {
        const h = header.getBoundingClientRect();
        if (rect.bottom <= h.bottom + 2) {
          hidden.push(`${name} rests entirely behind the header`);
        } else if (fits && rect.top < h.bottom - 2 && rect.bottom > h.top) {
          grazed.push(`${name} overlaps the header by ${round(h.bottom - rect.top)}px`);
        }
      }
    }
    return { hidden: hidden.slice(0, 8), grazed: grazed.slice(0, 8) };
  }, steps);
}

async function run() {
  mkdirSync(OUT, { recursive: true });

  const routes = ROUTES.filter((r) => MOBILE_ROUTE_IDS.includes(r.id));
  if (routes.length !== MOBILE_ROUTE_IDS.length) {
    const missing = MOBILE_ROUTE_IDS.filter((id) => !routes.some((r) => r.id === id));
    throw new Error(`these route ids are not in the shared route list: ${missing.join(', ')}`);
  }
  const viewports = args.viewports
    ? VIEWPORTS.filter((v) => String(args.viewports).split(',').includes(v.id))
    : VIEWPORTS;
  if (!viewports.length) throw new Error('no viewport matched --viewports');

  // The same guard the matrix uses. A run against a blank page or against
  // something else that happens to be on the port reports no failures at all,
  // which reads exactly like success.
  const probe = await fetch(BASE, { redirect: 'follow' }).catch((e) => {
    throw new Error(`cannot reach ${BASE}: ${e.message}`);
  });
  if (!probe.ok) throw new Error(`${BASE} answered ${probe.status}`);
  const html = await probe.text();
  if (!/<title>[^<]*Universe Explorer/i.test(html)) {
    throw new Error(`${BASE} is not serving Universe Explorer`);
  }
  const build = (html.match(/main\.([a-f0-9]{8,})\.js/) || [, 'unknown'])[1];

  // The viewport meta is a single line that decides whether the safe-area rules
  // in the stylesheet can do anything at all, and whether the visitor is
  // allowed to zoom. Both have been wrong here before, and neither shows up in
  // a screenshot.
  const meta = (html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i) || [''])[0];
  if (!/viewport-fit\s*=\s*cover/i.test(meta)) {
    fail('viewport', 'the viewport meta does not ask for viewport-fit=cover, so safe-area insets are all zero and the shell cannot reach the edges of the screen');
  } else {
    pass('viewport', 'viewport-fit=cover is asked for');
  }
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*(1|1\.0)\b/i.test(meta)) {
    fail('viewport', 'the viewport meta disables zoom, which takes the page away from everyone who enlarges it to read');
  } else {
    pass('viewport', 'zoom is not restricted');
  }

  const browser = await BROWSER.launch({
    args: ENGINE_NAME === 'chromium'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [],
  });

  const report = [];

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      // Emulate the device, not just its size.
      //
      // `hasTouch` alone delivers touch events and leaves the CSS pointer
      // reporting `fine`, so every `@media (pointer: coarse)` rule in the
      // product went unexercised here while appearing to be covered. That is
      // the worst kind of gap: a run that is green about rules it never ran.
      // `isMobile` is what makes Chromium report a coarse pointer and no hover,
      // which is the environment those rules are written for.
      hasTouch: viewport.compact && CAN_EMULATE_MOBILE,
      ...(CAN_EMULATE_MOBILE ? { isMobile: viewport.compact } : {}),
      ...(viewport.compact && CAN_EMULATE_MOBILE ? { userAgent: devices['Pixel 7']?.userAgent } : {}),
    });
    await installFixtures(context, 'populated');

    // A cutout the browser cannot supply.
    //
    // Headless Chromium has no notch, so env(safe-area-inset-*) is zero
    // everywhere and every safe-area rule in the product is exercised with the
    // one value that makes it a no-op. Overriding the four custom properties
    // gives the layout real numbers to reserve room for, which is the thing
    // worth testing: whether the bar moves clear of a home indicator, not
    // whether env() parses.
    if (viewport.insets) {
      const { top, bottom, left, right } = viewport.insets;
      await context.addInitScript(([t, b, l, r]) => {
        const style = document.createElement('style');
        style.textContent = `:root{--u-safe-top:${t}px;--u-safe-bottom:${b}px;--u-safe-left:${l}px;--u-safe-right:${r}px;}`;
        const attach = () => document.head?.appendChild(style);
        if (document.head) attach();
        else document.addEventListener('DOMContentLoaded', attach, { once: true });
      }, [top, bottom, left, right]);
    }

    for (const route of routes) {
      // The second tier. A route outside the full sweep is measured at the
      // three narrow windows only; asking for a viewport explicitly overrides
      // the tiering, because a run with --viewports is someone chasing one
      // thing and it should measure exactly what was asked for.
      if (!args.viewports && !FULL_SWEEP_ROUTE_IDS.has(route.id) && !NARROW_VIEWPORT_IDS.has(viewport.id)) {
        continue;
      }
      const page = await context.newPage();
      const scope = `${route.id}@${viewport.id}`;
      try {
        await page.goto(BASE + route.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(2_400);

        if (route.open) {
          const control = page.locator(route.open).first();
          if (await control.count()) {
            await control.click();
            await page.waitForTimeout(400);
          }
        }

        const m = await page.evaluate(mobileProbe, { touchFloor: TOUCH_FLOOR, fieldFloor: FIELD_FLOOR });
        report.push({ route: route.id, viewport: viewport.id, ...m });

        // --- overflow ---
        if (m.overflowBy > 0) {
          fail(scope, `the page scrolls sideways by ${m.overflowBy}px at ${m.viewportWidth}px`
            + (m.culprits.length ? ` (${m.culprits.join('; ')})` : ''));
        }
        for (const c of m.clippers) {
          fail(scope, c);
        }
        for (const s of m.scrollers) {
          if (!s.declared) {
            fail(scope, `${s.el} scrolls sideways without saying so, so whatever is past its edge is present and unreachable`);
          } else if (!s.keyboardReachable) {
            fail(scope, `${s.el} scrolls sideways and holds nothing focusable, so a keyboard cannot reach past its edge`);
          }
        }

        // --- fields ---
        //
        // Only where a software keyboard is what opens. The desktop control
        // window is here to prove the mobile work did not regress the wide
        // layout, and a 14px field on a desktop with a mouse zooms nothing.
        if (viewport.compact) {
          for (const f of m.smallFields) {
            fail(scope, `${f}, under the ${FIELD_FLOOR}px at which iOS Safari zooms the page in on focus and leaves it zoomed`);
          }
        }

        // --- targets ---
        if (viewport.compact && m.targetsBelowWcag.length) {
          fail(scope, `${m.targetsBelowWcag.length} targets under 24px with another target inside the 24px circle around them, which is a WCAG 2.2 target-size failure: ${m.targetsBelowWcag.slice(0, 8).join(', ')}`);
        }
        if (viewport.compact && m.targetsBelowPlatform.length) {
          fail(scope, `${m.targetsBelowPlatform.length} shell or repeated controls under ${TOUCH_FLOOR}px: ${m.targetsBelowPlatform.slice(0, 8).join(', ')}`);
        }

        // --- fixed layers ---
        for (const h of m.atBottom.hidden) {
          fail(scope, `at the bottom of the page, ${h}`);
        }

        // --- open surfaces ---
        for (const s of m.overflowingSurfaces) {
          fail(scope, s);
        }

        // --- the bar ---
        if (viewport.compact && m.nav) {
          if (m.nav.scrolls && !m.nav.affordance) {
            fail(scope, 'the bottom bar scrolls sideways with nothing to say that it does');
          }
          if (m.nav.hasActive && m.nav.activeVisible === false) {
            fail(scope, 'the current destination is scrolled out of sight in the bottom bar, so the bar disagrees with the page about where the visitor is');
          }
        }

        // --- safe areas ---
        if (viewport.insets) {
          const { top, bottom, left, right } = viewport.insets;
          if (bottom > 0 && m.chrome.barPadBottom !== null && m.chrome.barPadBottom < bottom) {
            fail(scope, `the bottom bar reserves ${m.chrome.barPadBottom}px for a ${bottom}px home indicator, so its targets are in the gesture area`);
          }
          if (top > 0 && m.chrome.headerPadTop !== null && m.chrome.headerPadTop < top) {
            fail(scope, `the header reserves ${m.chrome.headerPadTop}px for a ${top}px cutout, so it renders underneath it`);
          }
          const side = Math.max(left, right);
          if (side > 0 && m.chrome.barPadLeft !== null && Math.max(m.chrome.barPadLeft, m.chrome.barPadRight) < side) {
            fail(scope, `the bottom bar reserves ${m.chrome.barPadLeft}px at the sides for a ${side}px cutout, so a destination sits under it in landscape`);
          }
        }

        // --- focus, on the shell routes only ---
        //
        // Walking every focusable control on a table page is hundreds of
        // focus moves and a frame apiece. The fault it looks for belongs to
        // the shell rather than to any one page, so it is measured on the
        // routes where the shell is all there is, and on the tallest and
        // shortest windows where it actually bites.
        if (viewport.compact && (route.id === 'home' || route.id === 'tx')) {
          const focus = await focusWalk(page, 60);
          for (const o of focus.hidden) {
            fail(scope, `${o}, which is a WCAG 2.2 AA focus-obscured failure`);
          }
          for (const o of focus.grazed) {
            grazes.push(`${scope}: ${o}`);
          }
        }

        // --- continuity across a rotation ---
        //
        // Rotating a phone must not be a navigation. This turns the window on
        // its side, then back, and checks that the route, the query string and
        // the reading position all survived. A shell that rebuilds itself on
        // resize loses all three, and it is invisible in a screenshot because
        // every individual frame looks correct.
        if (viewport.compact && route.id === 'tx') {
          await page.evaluate(() => window.scrollTo(0, Math.min(600, document.body.scrollHeight)));
          await page.waitForTimeout(250);
          const before = await page.evaluate(() => ({ url: location.pathname + location.search, y: window.scrollY }));
          await page.setViewportSize({ width: viewport.height, height: viewport.width });
          await page.waitForTimeout(500);
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.waitForTimeout(500);
          const after = await page.evaluate(() => ({ url: location.pathname + location.search, y: window.scrollY }));
          if (before.url !== after.url) {
            fail(scope, `rotating the device navigated from ${before.url} to ${after.url}`);
          } else if (Math.abs(before.y - after.y) > Math.max(200, viewport.height * 0.5)) {
            fail(scope, `rotating the device moved the reading position from ${before.y} to ${after.y}`);
          } else {
            pass(scope, 'a rotation and a rotation back keep the route and the reading position');
          }
        }
      } catch (error) {
        if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(error))) {
          await browser.close().catch(() => undefined);
          console.error(`\nThe server at ${BASE} stopped answering at ${scope}. Nothing after that point was measured, so this run proves nothing.`);
          process.exit(1);
        }
        fail(scope, `could not be measured: ${String(error).slice(0, 200)}`);
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    await context.close();
  }

  await browser.close();

  writeFileSync(join(OUT, 'mobile-report.json'), JSON.stringify({ base: BASE, browser: ENGINE_NAME, build, report, findings, grazes, passes }, null, 2));

  console.log(`\nMobile gate, build ${build}`);
  console.log(`${routes.length} routes across ${viewports.length} window sizes, ${report.length} measured pages\n`);
  if (passes.length) {
    console.log(`-- ${passes.length} checks with something to say that passed --`);
    for (const p of passes.slice(0, 12)) console.log(`  ${p}`);
    console.log('');
  }
  if (grazes.length) {
    // Printed every run, never suppressed. This is the difference between the
    // engines, and a reader who cannot see it cannot judge it.
    console.log(`-- ${grazes.length} focused controls landing partly under a fixed layer --`);
    console.log('   AA asks that focus not be entirely hidden, which holds everywhere. This is the');
    console.log('   AAA rule, and it is where the engines differ on re-scrolling something already');
    console.log('   partly in view.');
    for (const g of grazes.slice(0, 20)) console.log(`  ${g}`);
    if (grazes.length > 20) console.log(`  ... and ${grazes.length - 20} more, see the report`);
    console.log('');
  }
  if (findings.length) {
    console.log(`-- ${findings.length} failures --`);
    for (const f of findings) console.log(`  ${f}`);
    console.log('');
    process.exit(1);
  }
  console.log('No mobile failures.\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((e) => { console.error(e); process.exit(1); });
}

export { VIEWPORTS, TOUCH_FLOOR, FIELD_FLOOR, mobileProbe };
