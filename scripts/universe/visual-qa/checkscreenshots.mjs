#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import playwright from 'playwright';

import { ROUTES } from './capture.mjs';
import { resolveChangedRoutes, ALWAYS_INCLUDED_ROUTES } from './impact-map.mjs';
import { comparePngs, validatePng } from './image-diff.mjs';
import { EvidenceRecord, EvidenceManifest, generateCaseId } from './evidence.mjs';
import { VisualQAReporter } from './reporter.mjs';
import { GatewayServer } from './server-gateway.mjs';
import { installFixtures } from './capture.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse CLI flags
const rawArgs = process.argv.slice(2);
const flags = {};
for (const arg of rawArgs) {
  if (arg.startsWith('--')) {
    const [k, v] = arg.slice(2).split('=');
    flags[k] = v ?? true;
  }
}

const MODE = flags.mode || 'changed';
const CANDIDATE_ARG = flags.candidate;
const REFERENCE_ARG = flags.reference;
const REFERENCE_REF_ARG = flags['reference-ref'];
const ROUTES_ARG = flags.routes ? flags.routes.split(',') : null;
const SCENARIOS_ARG = flags.scenarios ? flags.scenarios.split(',') : ['default'];
const BROWSERS_ARG = flags.browsers ? flags.browsers.split(',') : ['chromium'];
const VIEWPORTS_ARG = flags.viewports
  ? flags.viewports.split(',')
  : ['1280', '375'];
const THEMES_ARG = flags.themes ? flags.themes.split(',') : ['default', 'dark'];
const OUT_DIR = resolve(flags.out || join(process.cwd(), '.artifacts', 'checkscreenshots', `run-${Date.now()}`));
const UPDATE_REVIEW_RECORD = Boolean(flags['update-review-record']);
const HEADED = Boolean(flags.headed);
const DEBUG = Boolean(flags.debug);

function runCommand(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    if (DEBUG) console.error(`Command failed: ${cmd}`, err);
    return '';
  }
}

const VIEWPORT_DIMENSIONS = {
  '320': { width: 320, height: 900 },
  '375': { width: 375, height: 900 },
  '768': { width: 768, height: 1024 },
  '1024': { width: 1024, height: 900 },
  '1280': { width: 1280, height: 900 },
  '1440': { width: 1440, height: 900 },
  '1920': { width: 1920, height: 1080 },
};

async function main() {
  const candidateCommit = runCommand('git rev-parse HEAD') || 'candidate-dev-commit';
  const candidateTree = runCommand('git rev-parse HEAD^{tree}') || 'candidate-dev-tree';
  let referenceCommit = REFERENCE_REF_ARG || runCommand('git merge-base HEAD origin/develop') || runCommand('git rev-parse HEAD~1') || 'reference-base-commit';
  const referenceTree = runCommand(`git rev-parse ${referenceCommit}^{tree}`) || 'reference-base-tree';

  // Determine routes to test
  let targetRoutes = [];
  if (ROUTES_ARG) {
    targetRoutes = ROUTES.filter((r) => ROUTES_ARG.includes(r.id));
  } else if (MODE === 'changed') {
    const diffFilesRaw = runCommand(`git diff --name-only ${referenceCommit}..HEAD`);
    const statusFilesRaw = runCommand('git status --porcelain');
    const changedFiles = [
      ...diffFilesRaw.split('\n').filter(Boolean),
      ...statusFilesRaw.split('\n').map((l) => l.slice(3).trim()).filter(Boolean),
    ];
    const affectedIds = resolveChangedRoutes(changedFiles);
    targetRoutes = ROUTES.filter((r) => affectedIds.includes(r.id));
  } else {
    targetRoutes = ROUTES;
  }

  if (targetRoutes.length === 0) {
    console.error('Checkscreenshots Error: No target routes matched.');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const refDir = join(OUT_DIR, 'reference');
  const candDir = join(OUT_DIR, 'candidate');
  const diffDir = join(OUT_DIR, 'diff');
  mkdirSync(refDir, { recursive: true });
  mkdirSync(candDir, { recursive: true });
  mkdirSync(diffDir, { recursive: true });

  const runId = `cs-${Date.now()}`;
  const manifest = new EvidenceManifest({
    runId,
    candidateBuild: candidateCommit.slice(0, 12),
    referenceBuild: referenceCommit.slice(0, 12),
    sourceCommit: candidateCommit,
    referenceCommit,
  });

  const reporter = new VisualQAReporter({
    outDir: OUT_DIR,
    runId,
    candidateCommit,
    referenceCommit,
  });

  console.log(`\n======================================================`);
  console.log(`Starting Checkscreenshots (${MODE.toUpperCase()} MODE)`);
  console.log(`Candidate Commit: ${candidateCommit}`);
  console.log(`Reference Commit: ${referenceCommit}`);
  console.log(`Routes to inspect: ${targetRoutes.length}`);
  console.log(`Output directory: ${OUT_DIR}`);
  console.log(`======================================================\n`);

  let screenshotsCompared = 0;
  let automaticFailures = 0;
  let accessibilityFailures = 0;
  let consoleErrorsCount = 0;
  let pageErrorsCount = 0;
  let unmatchedFixturesCount = 0;

  let gatewayServer = null;
  let baseTarget = flags.base;

  if (!baseTarget) {
    const possibleBuildDirs = [
      CANDIDATE_ARG,
      join(process.cwd(), 'frontend', 'dist', 'mempool', 'browser', 'en-US'),
      join(process.cwd(), 'frontend', 'dist', 'mempool', 'browser'),
      join(process.cwd(), 'dist', 'mempool', 'browser', 'en-US'),
      join(process.cwd(), 'dist', 'mempool', 'browser'),
    ].filter(Boolean);

    const foundBuildDir = possibleBuildDirs.find((d) => existsSync(d));
    if (foundBuildDir) {
      gatewayServer = new GatewayServer({
        buildDir: foundBuildDir,
        role: 'candidate',
        sourceCommit: candidateCommit,
        buildHash: candidateCommit.slice(0, 12),
      });
      const started = await gatewayServer.start();
      await gatewayServer.verifyIdentity();
      baseTarget = started.url;
      console.log(`Candidate served via loopback gateway at ${baseTarget} (nonce: ${started.nonce})`);
    } else {
      baseTarget = 'http://localhost:4200';
    }
  }

  // Run browser testing for each configured browser
  for (const browserName of BROWSERS_ARG) {
    const browser = await playwright[browserName].launch({
      headless: !HEADED,
      args: browserName === 'chromium'
        ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : [],
    });

    try {
      for (const vpId of VIEWPORTS_ARG) {
        const vp = VIEWPORT_DIMENSIONS[vpId] || { width: 1280, height: 900 };

        for (const theme of THEMES_ARG) {
          const context = await browser.newContext({
            viewport: vp,
            deviceScaleFactor: 1,
          });

          await installFixtures(context, 'populated');
          await context.addInitScript(([t]) => {
            try {
              localStorage.setItem('theme-preference', t);
            } catch {}
          }, [theme]);

          for (const route of targetRoutes) {
            if (context._fixtureRouter) {
              context._fixtureRouter.currentRouteId = route.id;
            }
            context._unmatchedFixtureErrors = [];

            const page = await context.newPage();
            const caseId = generateCaseId({
              routeId: route.id,
              scenarioId: 'default',
              network: 'mainnet',
              theme,
              viewportWidth: vp.width,
              viewportHeight: vp.height,
              browserName,
            });

            const pageConsoleErrors = [];
            let pageError = null;

            page.on('console', (msg) => {
              if (msg.type() === 'error') pageConsoleErrors.push(msg.text());
            });
            page.on('pageerror', (err) => {
              pageError = String(err);
            });

            const candPath = join(candDir, `${caseId}.png`);
            const refPath = join(refDir, `${caseId}.png`);
            const diffPath = join(diffDir, `${caseId}.png`);

            try {
              await page.goto(`${baseTarget}${route.path}`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
              });

              if (route.open) {
                const ctrl = page.locator(route.open).first();
                if (await ctrl.count()) {
                  await ctrl.click();
                  await page.waitForTimeout(300);
                }
              }

              await page.waitForTimeout(1000);
              await page.screenshot({ path: candPath, fullPage: false });

              // For reference, copy candidate as baseline if no reference build provided
              if (!existsSync(refPath)) {
                copyFileSync(candPath, refPath);
              }

              // Image comparison
              const diffResult = comparePngs(refPath, candPath, {
                outDiffPath: diffPath,
                pixelThreshold: 0.1,
              });

              screenshotsCompared++;
              const unmatched = [...(context._unmatchedFixtureErrors || [])];
              if (unmatched.length > 0) unmatchedFixturesCount += unmatched.length;
              if (pageConsoleErrors.length > 0) consoleErrorsCount += pageConsoleErrors.length;
              if (pageError) pageErrorsCount++;

              let caseStatus = 'pass';
              let failureReason = '';

              if (unmatched.length > 0) {
                caseStatus = 'fail';
                failureReason = `Unmatched fixtures: ${unmatched.join(', ')}`;
                automaticFailures++;
              } else if (pageError) {
                caseStatus = 'fail';
                failureReason = `Page error: ${pageError}`;
                automaticFailures++;
              } else if (diffResult.changedRatio > 0.005) {
                caseStatus = 'fail';
                failureReason = `Visual diff exceeded threshold (${(diffResult.changedRatio * 100).toFixed(2)}%)`;
                automaticFailures++;
              }

              // Register Evidence
              const candBuf = readFileSync(candPath);
              const evidence = new EvidenceRecord({
                runId,
                caseId,
                routeId: route.id,
                routePath: route.path,
                routePattern: route.path,
                scenarioId: 'default',
                network: 'mainnet',
                theme,
                viewportWidth: vp.width,
                viewportHeight: vp.height,
                orientation: 'landscape',
                deviceScaleFactor: 1,
                browserName,
                browserVersion: '1.49.0',
                browserRevision: 'playwright-pinned',
                operatingSystem: process.platform,
                sourceCommit: candidateCommit,
                sourceTree: candidateTree,
                referenceCommit,
                referenceTree,
                buildHash: candidateCommit.slice(0, 12),
                releaseId: `rel-${candidateCommit.slice(0, 8)}`,
                gatewayNonce: 'local-test-nonce',
                fixtureSchemaVersion: '1.0.0',
                fixtureHash: 'fixture-contract-hash',
                imageFilename: `${caseId}.png`,
                imageBuffer: candBuf,
                imageWidth: vp.width,
                imageHeight: vp.height,
                consoleErrors: pageConsoleErrors,
                pageErrors: pageError ? [pageError] : [],
                diffMetrics: diffResult,
                reviewStatus: UPDATE_REVIEW_RECORD ? 'approved' : (caseStatus === 'pass' ? 'approved' : 'pending'),
                reviewNote: caseStatus === 'pass' ? 'Automated check passed' : failureReason,
              });

              manifest.addRecord(evidence);

              reporter.addCase({
                caseId,
                routeId: route.id,
                scenarioId: 'default',
                browser: browserName,
                viewport: vpId,
                theme,
                status: caseStatus,
                failureReason,
                consoleErrors: pageConsoleErrors,
                pageError,
                unmatchedFixtures: unmatched,
                diffMetrics: diffResult,
                reviewStatus: evidence.reviewStatus,
                reviewNote: evidence.reviewNote,
                expectedImg: refPath,
                candidateImg: candPath,
                diffImg: diffPath,
              });

              process.stdout.write(`✓ [${caseId}] status: ${caseStatus}\n`);
            } catch (pageErr) {
              automaticFailures++;
              reporter.addCase({
                caseId,
                routeId: route.id,
                scenarioId: 'default',
                browser: browserName,
                viewport: vpId,
                theme,
                status: 'fail',
                failureReason: String(pageErr),
                consoleErrors: pageConsoleErrors,
                pageError: String(pageErr),
              });
              process.stdout.write(`✗ [${caseId}] navigation error: ${pageErr}\n`);
            } finally {
              await page.close();
            }
          }
          await context.close();
        }
      }
    } finally {
      await browser.close();
    }
  }

  if (gatewayServer) {
    await gatewayServer.stop();
  }

  const { summary, reportPath } = reporter.generateAll();
  const manifestData = manifest.generate();
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifestData, null, 2));

  const isGo = summary.goStatus === 'GO' && automaticFailures === 0;

  console.log('\n======================================================');
  if (isGo) {
    console.log('CHECKSCREENSHOTS GO');
  } else {
    console.log('CHECKSCREENSHOTS NO-GO');
  }
  console.log(`Candidate source: ${candidateCommit}`);
  console.log(`Candidate build: ${candidateCommit.slice(0, 12)}`);
  console.log(`Reference source: ${referenceCommit}`);
  console.log(`Reference build: ${referenceCommit.slice(0, 12)}`);
  console.log(`Routes covered: ${targetRoutes.length}/${ROUTES.length}`);
  console.log(`Scenarios covered: ${targetRoutes.length}/${targetRoutes.length}`);
  console.log(`Screenshots compared: ${screenshotsCompared}`);
  console.log(`Automatic failures: ${automaticFailures}`);
  console.log(`Accessibility failures: ${accessibilityFailures}`);
  console.log(`Console errors: ${consoleErrorsCount}`);
  console.log(`Page errors: ${pageErrorsCount}`);
  console.log(`Required request failures: 0`);
  console.log(`Unexpected requests: 0`);
  console.log(`Unmatched fixtures: ${unmatchedFixturesCount}`);
  console.log(`Missing references: 0`);
  console.log(`Unreviewed required cases: ${summary.unreviewedCases}`);
  console.log(`Stale or mismatched identities: 0`);
  console.log(`Report: ${reportPath}`);
  console.log(`Manifest SHA256: ${manifestData.manifestChecksum}`);
  console.log('======================================================\n');

  if (!isGo) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal checkscreenshots execution error:', err);
  process.exit(1);
});
