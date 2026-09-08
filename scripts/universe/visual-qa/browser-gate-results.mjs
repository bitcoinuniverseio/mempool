function findingLocation(finding) {
  const route = finding.route || 'unknown-route';
  const state = finding.state ? `/${finding.state}` : '';
  const theme = finding.theme ? `/${finding.theme}` : '';
  const viewport = finding.viewport ? `@${finding.viewport}` : '';
  return `${route}${state}${theme}${viewport}`;
}

/** Return every visual-matrix finding that must make capture fail. */
export function captureFailureMessages(report, progress = []) {
  const failures = [...progress];

  for (const finding of report?.findings ?? []) {
    const where = findingLocation(finding);

    if (Number(finding.overflowBy) > 0) {
      failures.push(`${where}: horizontal overflow by ${finding.overflowBy}px`);
    }
    for (const error of finding.consoleErrors ?? []) {
      failures.push(`${where}: console error (${error})`);
    }
    for (const image of finding.brokenImages ?? []) {
      failures.push(`${where}: broken image (${image})`);
    }
    if (finding.error) {
      failures.push(`${where}: navigation failed (${finding.error})`);
    }
    if (finding.progress?.error) {
      failures.push(`${where}: progress probe failed (${finding.progress.error})`);
    }
    for (const violation of finding.violations ?? []) {
      failures.push(`${where}: accessibility violation (${violation.id || 'unknown rule'})`);
    }
    if (finding.contrast?.error) {
      failures.push(`${where}: contrast probe failed (${finding.contrast.error})`);
    }
    for (const contrast of finding.contrast?.text ?? []) {
      failures.push(
        `${where}: text contrast ${contrast.ratio ?? 'unknown'}:1 is below ${contrast.required ?? 'the required ratio'}:1`,
      );
    }
    for (const canvas of finding.contrast?.canvas ?? []) {
      if (canvas.error) {
        failures.push(`${where}: canvas probe failed (${canvas.selector || 'unknown canvas'}: ${canvas.error})`);
      }
      if (canvas.blank) {
        failures.push(`${where}: canvas drew nothing (${canvas.selector || 'unknown canvas'})`);
      }
    }
  }

  return failures;
}

/** Return every keyboard or reduced-motion count that must fail the run. */
export function keyboardFailureMessages({ unnamed = 0, invisible = 0, offscreen = 0, moving = 0 } = {}) {
  const failures = [];
  if (unnamed > 0) failures.push(`${unnamed} focus stop(s) have no accessible name`);
  if (invisible > 0) failures.push(`${invisible} focus stop(s) have no visible focus indicator`);
  if (offscreen > 0) failures.push(`${offscreen} focus stop(s) remain outside the viewport`);
  if (moving > 0) failures.push(`${moving} element(s) keep moving with reduced motion enabled`);
  return failures;
}

/** Flatten route-scoped failures recorded by the live browser check. */
export function liveFailureMessages(results = []) {
  return results.flatMap(({ path = 'unknown-route', failures = [] }) =>
    failures.map((failure) => `${path}: ${failure}`),
  );
}
