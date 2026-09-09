/**
 * The runner's own network, kept apart from the origin's behaviour.
 *
 * Chromium reports `net::ERR_NETWORK_CHANGED` when an interface on the
 * machine it runs on changes while a resource is loading; every load in
 * flight is abandoned. On 9 September 2026 that happened on three different
 * self-hosted runners during the browser steps of the production smoke, and
 * each time the run blamed the origin: a page that had answered every request
 * was reported as rendering nothing. A page cannot cause this and the origin
 * cannot cause this, so one navigation is retried once when it is the reason,
 * and the retry is written into the run's notes rather than hidden.
 */
export const RUNNER_NETWORK_CHANGED = 'net::ERR_NETWORK_CHANGED';

/** True when a console line, a request failure or a thrown error carries the runner-side signal. */
export function isRunnerNetworkChange(text) {
  return typeof text === 'string' && text.includes(RUNNER_NETWORK_CHANGED);
}

/**
 * Split observations into the origin's and the runner's. Only lines that
 * carry the exact Chromium signal are set aside; everything else stays.
 */
export function separateRunnerNetworkErrors(lines) {
  const runner = [];
  const origin = [];
  for (const line of lines) (isRunnerNetworkChange(line) ? runner : origin).push(line);
  return { runner, origin };
}

/**
 * Navigate, and navigate once more if the first attempt was undone by the
 * runner's network changing under it. `collected` is the array of console
 * errors the caller records for the page; the lines the flap produced are
 * moved out of it into the returned notes so the audit judges the origin's
 * behaviour on the attempt that actually completed. Any other failure is
 * rethrown untouched.
 */
export async function navigateTolerantly(page, url, options, collected, { attempts = 2, pauseMs = 3000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const notes = [];
  for (let attempt = 1; ; attempt++) {
    const before = collected.length;
    try {
      await page.goto(url, options);
    } catch (error) {
      const seen = collected.slice(before);
      const flapped = isRunnerNetworkChange(String(error)) || seen.some(isRunnerNetworkChange);
      if (!flapped || attempt >= attempts) throw error;
      collected.splice(before);
      notes.push(`runner network changed during navigation to ${url}; retried once (${seen.filter(isRunnerNetworkChange).length} abandoned load(s))`);
      await sleep(pauseMs);
      continue;
    }
    const seen = collected.slice(before);
    const flaps = seen.filter(isRunnerNetworkChange);
    if (flaps.length && attempt < attempts) {
      collected.splice(before);
      notes.push(`runner network changed while ${url} was loading; retried once (${flaps.length} abandoned load(s))`);
      await sleep(pauseMs);
      continue;
    }
    return { notes };
  }
}
