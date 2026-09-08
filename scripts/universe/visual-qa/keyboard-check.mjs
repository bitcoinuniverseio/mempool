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
 * Usage:  node keyboard-check.mjs [--base=http://localhost:4300]
 *         [--routes=home,portfolio-overview] [--route=/]
 */

import * as playwright from "playwright";
import { keyboardFailureMessages } from "./browser-gate-results.mjs";
import { installFixtures } from "./capture.mjs";
import {
  seedPortfolioVault,
  unlockPortfolioRoute,
} from "./portfolio-fixture.mjs";
import { routesFor } from "./route-scenarios.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const BASE = args.base || "http://localhost:4300";
const REGISTERED_ROUTES = routesFor("keyboard");
const ROUTES = args.route
  ? String(args.route)
      .split(",")
      .map(
        (path) =>
          REGISTERED_ROUTES.find((route) => route.path === path) ?? {
            id: path,
            path,
          },
      )
  : args.routes
    ? REGISTERED_ROUTES.filter((route) =>
        String(args.routes).split(",").includes(route.id),
      )
    : REGISTERED_ROUTES;
if (args.routes) {
  const missing = String(args.routes)
    .split(",")
    .filter((id) => !ROUTES.some((route) => route.id === id));
  if (missing.length)
    throw new Error(`Unknown keyboard route ids: ${missing.join(", ")}`);
}
const STOPS = Number(args.stops || 28);

/** Does the focused element actually show that it is focused? */
function focusReport() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const name =
    el.getAttribute("aria-label") ||
    (el.labels && el.labels[0]?.textContent?.trim()) ||
    el.textContent?.trim().slice(0, 40) ||
    el.getAttribute("title") ||
    "";
  const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
  const ring = cs.boxShadow !== "none" && cs.boxShadow !== "";
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
  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    // A duration the reduced-motion rule has already collapsed to a hundredth
    // of a millisecond is stopped, not moving. Counting it as motion made the
    // check report failures against its own fix.
    const STOPPED = 0.05; // seconds
    const animated =
      cs.animationName !== "none" && parseFloat(cs.animationDuration) > STOPPED;
    const transitioned =
      cs.transitionProperty !== "none" &&
      cs.transitionProperty !== "all" &&
      parseFloat(cs.transitionDuration) > 0.35 &&
      parseFloat(cs.transitionDuration) > STOPPED;
    if (animated || transitioned) {
      moving.push({
        selector:
          el.tagName.toLowerCase() +
          (el.className && typeof el.className === "string"
            ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
            : ""),
        animation: animated
          ? `${cs.animationName} ${cs.animationDuration}`
          : "",
        transition: transitioned
          ? `${cs.transitionProperty} ${cs.transitionDuration}`
          : "",
      });
    }
    if (moving.length > 25) break;
  }
  return moving;
}

const browser = await playwright.chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});

let unnamed = 0;
let invisible = 0;
let offscreen = 0;

for (const route of ROUTES) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const fixtureAudit = await installFixtures(context, "populated");
  await seedPortfolioVault(context, BASE, [route]);
  const page = await context.newPage();
  await page.goto(BASE + route.path, { waitUntil: "domcontentloaded" });
  await unlockPortfolioRoute(page, route);
  await page.waitForTimeout(2500);

  console.log(`\n=== ${route.path} : tab order ===`);
  const seen = [];
  for (let i = 0; i < STOPS; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(focusReport);
    if (!stop) continue;
    seen.push(stop);
    const flags = [];
    if (!stop.name) {
      flags.push("NO NAME");
      unnamed++;
    }
    if (!stop.visibleFocus) {
      flags.push("NO VISIBLE FOCUS");
      invisible++;
    }
    if (!stop.inViewport) {
      flags.push("OFFSCREEN");
      offscreen++;
    }
    console.log(
      `  ${String(i + 1).padStart(2)} ${stop.tag.padEnd(8)} ${stop.size.padEnd(9)} ` +
        `${(stop.name || "(unnamed)").slice(0, 44).padEnd(46)} ${flags.join(" ")}`,
    );
  }
  fixtureAudit.assertComplete(`keyboard/${route.id}`);
  await context.close();
}

console.log("\n=== reduced motion ===");
const reduced = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  reducedMotion: "reduce",
});
const reducedFixtureAudit = await installFixtures(reduced, "populated");
const rp = await reduced.newPage();
await rp.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await rp.waitForTimeout(2500);
const moving = await rp.evaluate(movingElements);
if (!moving.length) {
  console.log("  nothing is still animating or transitioning slowly");
} else {
  for (const m of moving) {
    console.log(
      `  ${m.selector.slice(0, 52).padEnd(54)} ${m.animation} ${m.transition}`,
    );
  }
}
reducedFixtureAudit.assertComplete("keyboard/reduced-motion");
await reduced.close();
await browser.close();

console.log(`\nstops without an accessible name : ${unnamed}`);
console.log(`stops without a visible focus    : ${invisible}`);
console.log(`stops outside the viewport        : ${offscreen}`);
console.log(`elements still moving (reduced)  : ${moving.length}\n`);

const failures = keyboardFailureMessages({
  unnamed,
  invisible,
  offscreen,
  moving: moving.length,
});
for (const failure of failures) console.error(`  FAIL  ${failure}`);
process.exitCode = failures.length ? 1 : 0;
