import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Generates test report artifacts: report.html, summary.json, review.json, and junit.xml.
 */
export class VisualQAReporter {
  constructor({ outDir, runId, candidateCommit, referenceCommit, manifest }) {
    this.outDir = resolve(outDir);
    this.runId = runId;
    this.candidateCommit = candidateCommit;
    this.referenceCommit = referenceCommit;
    this.manifest = manifest || {};
    this.cases = [];
  }

  addCase(caseData) {
    this.cases.push(caseData);
  }

  generateAll() {
    mkdirSync(this.outDir, { recursive: true });

    const summary = this.generateSummary();
    const review = this.generateReview();
    const junit = this.generateJUnit();
    const html = this.generateHtml(summary);

    writeFileSync(join(this.outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(join(this.outDir, 'review.json'), JSON.stringify(review, null, 2));
    writeFileSync(join(this.outDir, 'junit.xml'), junit);
    writeFileSync(join(this.outDir, 'report.html'), html);

    return { summary, review, reportPath: join(this.outDir, 'report.html') };
  }

  generateSummary() {
    const total = this.cases.length;
    const failedCases = this.cases.filter((c) => c.status === 'fail' || c.status === 'failed');
    const changedCases = this.cases.filter((c) => (c.diffMetrics?.changedPixels ?? 0) > 0);
    const consoleErrorCases = this.cases.filter((c) => (c.consoleErrors?.length ?? 0) > 0);
    const pageErrorCases = this.cases.filter((c) => Boolean(c.pageError));
    const a11yCases = this.cases.filter((c) => (c.accessibilityViolations?.length ?? 0) > 0);
    const unmatchedCases = this.cases.filter((c) => (c.unmatchedFixtures?.length ?? 0) > 0);
    const missingRefCases = this.cases.filter((c) => c.status === 'missing_reference');
    const unreviewedCases = this.cases.filter((c) => !c.reviewStatus || c.reviewStatus === 'pending');

    const isGo =
      total > 0 &&
      failedCases.length === 0 &&
      consoleErrorCases.length === 0 &&
      pageErrorCases.length === 0 &&
      unmatchedCases.length === 0 &&
      a11yCases.length === 0 &&
      unreviewedCases.length === 0;

    return {
      runId: this.runId,
      candidateCommit: this.candidateCommit,
      referenceCommit: this.referenceCommit,
      totalScreenshots: total,
      automaticFailures: failedCases.length,
      changedScreenshots: changedCases.length,
      accessibilityFailures: a11yCases.length,
      consoleErrors: consoleErrorCases.length,
      pageErrors: pageErrorCases.length,
      unmatchedFixtures: unmatchedCases.length,
      missingReferences: missingRefCases.length,
      unreviewedCases: unreviewedCases.length,
      goStatus: isGo ? 'GO' : 'NO_GO',
      generatedAtUtc: new Date().toISOString(),
    };
  }

  generateReview() {
    return {
      runId: this.runId,
      updatedAtUtc: new Date().toISOString(),
      records: this.cases.map((c) => ({
        caseId: c.caseId,
        routeId: c.routeId,
        scenarioId: c.scenarioId,
        browser: c.browser,
        viewport: c.viewport,
        theme: c.theme,
        reviewStatus: c.reviewStatus || 'pending',
        reviewNote: c.reviewNote || '',
        diffChangedPixels: c.diffMetrics?.changedPixels ?? 0,
        diffRatio: c.diffMetrics?.changedRatio ?? 0,
      })),
    };
  }

  generateJUnit() {
    const suites = {};
    for (const c of this.cases) {
      const suiteName = c.routeId || 'general';
      if (!suites[suiteName]) suites[suiteName] = [];
      suites[suiteName].push(c);
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n';
    for (const [name, tests] of Object.entries(suites)) {
      const suiteFailures = tests.filter((t) => t.status === 'fail' || t.status === 'failed').length;
      xml += `  <testsuite name="${name}" tests="${tests.length}" failures="${suiteFailures}">\n`;
      for (const t of tests) {
        xml += `    <testcase name="${t.caseId}" classname="${t.routeId}">\n`;
        if (t.status === 'fail' || t.status === 'failed') {
          const metricsCopy = { ...t.diffMetrics };
          delete metricsCopy.diffBuffer;
          delete metricsCopy.overlayBuffer;
          xml += `      <failure message="${escapeXml(t.failureReason || 'Visual or assertion failure')}">\n`;
          xml += `        ${escapeXml(JSON.stringify(metricsCopy, null, 2))}\n`;
          xml += '      </failure>\n';
        }
        xml += '    </testcase>\n';
      }
      xml += '  </testsuite>\n';
    }
    xml += '</testsuites>\n';
    return xml;
  }

  generateHtml(summary) {
    const casesJson = JSON.stringify(this.cases);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Checkscreenshots Visual QA Review - ${this.runId}</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --success: #22c55e;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 1.5rem;
    }
    header {
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-weight: bold;
      font-size: 0.875rem;
      text-transform: uppercase;
    }
    .status-go { background: var(--success); color: #000; }
    .status-nogo { background: var(--danger); color: #fff; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
    }
    .stat-val { font-size: 1.5rem; font-weight: bold; color: var(--accent); }
    .stat-lbl { font-size: 0.875rem; color: var(--text-muted); }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 1.5rem 0;
    }
    .btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.4rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.875rem;
    }
    .btn.active {
      background: var(--accent);
      color: #000;
      border-color: var(--accent);
    }
    .case-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .case-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .case-title { font-size: 1.125rem; font-weight: 600; }
    .img-compare-container {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      margin-top: 1rem;
    }
    .img-pane {
      flex: 1;
      min-width: 300px;
      background: #000;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.5rem;
      text-align: center;
    }
    .img-pane img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
    .meta-row { display: flex; gap: 1.5rem; font-size: 0.875rem; color: var(--text-muted); margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <header>
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h1>Checkscreenshots Visual Review</h1>
        <p class="stat-lbl">Run: ${this.runId} | Candidate: ${this.candidateCommit} | Reference: ${this.referenceCommit}</p>
      </div>
      <div>
        <span class="status-badge ${summary.goStatus === 'GO' ? 'status-go' : 'status-nogo'}">
          ${summary.goStatus}
        </span>
      </div>
    </div>
    <div class="grid">
      <div class="stat-card">
        <div class="stat-val">${summary.totalScreenshots}</div>
        <div class="stat-lbl">Total Screenshots</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${summary.automaticFailures}</div>
        <div class="stat-lbl">Automatic Failures</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${summary.changedScreenshots}</div>
        <div class="stat-lbl">Changed Images</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${summary.consoleErrors}</div>
        <div class="stat-lbl">Console Errors</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">${summary.unmatchedFixtures}</div>
        <div class="stat-lbl">Unmatched Fixtures</div>
      </div>
    </div>
  </header>

  <section>
    <div class="filters">
      <button class="btn active" onclick="setFilter('all')">All</button>
      <button class="btn" onclick="setFilter('failed')">Failed</button>
      <button class="btn" onclick="setFilter('changed')">Changed</button>
      <button class="btn" onclick="setFilter('unreviewed')">Unreviewed</button>
    </div>

    <div id="cases-list"></div>
  </section>

  <script>
    const cases = ${casesJson};
    let currentFilter = 'all';

    function setFilter(filter) {
      currentFilter = filter;
      document.querySelectorAll('.filters .btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      renderCases();
    }

    function renderCases() {
      const container = document.getElementById('cases-list');
      container.innerHTML = '';

      const filtered = cases.filter(c => {
        if (currentFilter === 'failed') return c.status === 'fail' || c.status === 'failed';
        if (currentFilter === 'changed') return (c.diffMetrics?.changedPixels ?? 0) > 0;
        if (currentFilter === 'unreviewed') return !c.reviewStatus || c.reviewStatus === 'pending';
        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); padding: 2rem; text-align: center;">No screenshots match this filter.</p>';
        return;
      }

      for (const c of filtered) {
        const card = document.createElement('div');
        card.className = 'case-card';
        const changedPx = c.diffMetrics?.changedPixels ?? 0;
        const ssim = c.diffMetrics?.ssim ? c.diffMetrics.ssim.toFixed(4) : '1.0000';

        card.innerHTML = \`
          <div class="case-header">
            <div>
              <span class="case-title">\${c.caseId}</span>
              <div class="meta-row">
                <span>Route: \${c.routeId}</span>
                <span>Viewport: \${c.viewport}</span>
                <span>Theme: \${c.theme}</span>
                <span>Browser: \${c.browser}</span>
              </div>
            </div>
            <div>
              <span class="status-badge \${c.status === 'pass' ? 'status-go' : 'status-nogo'}">\${c.status}</span>
            </div>
          </div>
          <div class="meta-row">
            <span>Changed Pixels: \${changedPx}</span>
            <span>SSIM Score: \${ssim}</span>
            <span>Review: <strong>\${c.reviewStatus || 'pending'}</strong></span>
          </div>
          <div class="img-compare-container">
            <div class="img-pane">
              <p class="stat-lbl">Expected</p>
              \${c.expectedImg ? '<img src="' + c.expectedImg + '" alt="Expected" />' : '<p style="padding:2rem;color:var(--text-muted)">None</p>'}
            </div>
            <div class="img-pane">
              <p class="stat-lbl">Candidate</p>
              \${c.candidateImg ? '<img src="' + c.candidateImg + '" alt="Candidate" />' : '<p style="padding:2rem;color:var(--text-muted)">None</p>'}
            </div>
            <div class="img-pane">
              <p class="stat-lbl">Difference</p>
              \${c.diffImg ? '<img src="' + c.diffImg + '" alt="Diff" />' : '<p style="padding:2rem;color:var(--text-muted)">No Diff</p>'}
            </div>
          </div>
        \`;
        container.appendChild(card);
      }
    }

    renderCases();
  </script>
</body>
</html>`;
  }
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
