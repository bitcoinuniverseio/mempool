/**
 * What a public chain page has to be true about, given the document behind it.
 *
 * Kept apart from the browser run in `chain-page-smoke.mjs` so it can be
 * tested. A gate that has only ever passed has not shown that it can fail, and
 * every defect this exists for shipped past a suite that was green: the pages
 * were rendered from fixtures, the API was read without a browser, and the
 * origin served an older build than either of them measured.
 *
 * Nothing here hard-codes a tip height, a readiness verdict or a Dogecoin
 * outage. Everything is asserted against the capability document the same run
 * just read, so a chain that truthfully reports it cannot answer passes, and a
 * page that fails to say so does not.
 */

const COMMIT_SHA = /^[0-9a-f]{7,64}$/;

/** The placeholder the overlay published to the public when nothing named it. */
export const PLACEHOLDER_RELEASE = 'development';

/**
 * Phrases the dashboard that shipped used, and this one must not.
 *
 * Each is a specific defect rather than a style preference. "What is happening
 * now" headed a block of static capability metadata describing nothing
 * happening. "Verified summary" and a bare key table were the generic record
 * renderer standing in for a designed page, and a reader cannot tell a page
 * that was designed from one that fell through to a fallback. So the words
 * those fallbacks print are what this looks for.
 */
export const OBSOLETE_DASHBOARD_PHRASES = [
  'What is happening now',
  'Verified summary',
  'Release development',
];

export const CHAIN_NAMES = { dogecoin: 'Dogecoin', zcash: 'Zcash' };

/** What each chain has to say about itself that the other one must not. */
export const CHAIN_TRUTHS = {
  dogecoin: [{ id: 'fee-unit', needle: 'per kilobyte' }],
  zcash: [
    { id: 'zip-317', needle: 'ZIP-317' },
    { id: 'shielded', needle: 'shielded' },
  ],
};

/**
 * The shape of this chain's snapshot identifier, taken from the one the
 * document just reported rather than assumed.
 *
 * Dogecoin's read `dogecoin-mainnet-<32 hex>` and Zcash's `zcash-<40 hex>`, and
 * neither is a contract. Keeping the literal prefix and the length of the
 * hexadecimal run after it survives a change to either, and still tells a whole
 * identifier apart from the shortened form the page shows.
 */
export function snapshotIdentifierShape(snapshotId) {
  const match = String(snapshotId).match(/^(.*?)([0-9a-f]{16,})$/);
  return match ? { prefix: match[1], hexLength: match[2].length } : null;
}

/** Whether any identifier of that shape, whole, appears in this text. */
export function carriesWholeSnapshotIdentifier(text, shape) {
  if (!shape) {
    return false;
  }
  for (let from = 0; ; ) {
    const at = text.indexOf(shape.prefix, from);
    if (at < 0) {
      return false;
    }
    const tail = text.slice(at + shape.prefix.length);
    let run = 0;
    while (run < tail.length && /[0-9a-f]/.test(tail[run])) {
      run += 1;
    }
    if (run >= shape.hexLength) {
      return true;
    }
    from = at + 1;
  }
}

/**
 * A raw code printed at a reader is not an explanation.
 *
 * The document states reasons as `confirmed-history-authority-unavailable`.
 * The page has an allowlist that turns each into a sentence, and shows an
 * unrecognised one as its own words rather than inventing a meaning. Both are
 * acceptable; printing the code itself as the whole explanation is not.
 */
export function looksLikeAnExplanation(text) {
  return text.length > 30 && text.split(/\s+/).length >= 6;
}

/**
 * The commit the origin serves against the one this run was pointed at.
 *
 * They are compared by prefix in both directions, because the site publishes an
 * abbreviated commit and a release is named by a full one.
 */
export function auditRelease(commit, expected) {
  if (!commit) {
    return { failures: ['release: the origin publishes no frontend commit'], notes: [] };
  }
  if (expected && !expected.startsWith(commit) && !commit.startsWith(expected)) {
    return {
      failures: [`release: the origin serves frontend ${commit}, and this run expected ${expected}`],
      notes: [],
    };
  }
  return { failures: [], notes: [`release: the origin serves frontend ${commit}`] };
}

/**
 * Everything the rendered page has to answer for.
 *
 * `seen` is what the browser observed, in the shape `readPageText` returns, or
 * null when the page carried none of this dashboard's structure at all. That
 * last case is not an error to be thrown: it is the exact state that reached
 * production, an origin serving the dashboard this one replaced, and it has to
 * be reported as the finding it is.
 */
export function auditChainPage({ chain, envelope, seen, observations = {} }) {
  const scope = `page:${chain}`;
  const failures = [];
  const notes = [];
  const fail = (message) => failures.push(`${scope}: ${message}`);
  const pass = (message) => notes.push(`${scope}: ${message}`);
  const name = CHAIN_NAMES[chain] ?? chain;

  if (!envelope) {
    fail('the capability document could not be read, so there is nothing to hold the page to');
    return { failures, notes };
  }
  if (!seen) {
    fail(
      'the page has no labelled status rail, so this origin is not serving the chain dashboard this release ships',
    );
    return { failures, notes };
  }

  // Identity. A page that renders the wrong chain is the failure that put
  // Bitcoin's name on a Dogecoin tab, and it renders perfectly. Compared
  // without case, because the heading is set in capitals by the stylesheet and
  // innerText reports what is rendered.
  const heading = (seen.headings?.[0] ?? '').toLowerCase();
  if (!heading.includes(name.toLowerCase())) {
    fail(
      `the first heading is ${JSON.stringify(seen.headings?.[0] ?? '')}, which does not name ${name}`,
    );
  } else {
    pass(`identifies itself as ${name}`);
  }
  const other = chain === 'dogecoin' ? 'Zcash' : 'Dogecoin';
  if (seen.primary.toLowerCase().includes(other.toLowerCase())) {
    fail(`the ${name} page mentions ${other} in its own content`);
  }

  // The status rail: labelled readings, not a run-on line of facts.
  const rail = seen.rail ?? [];
  if (rail.length < 5) {
    fail(`the status rail has ${rail.length} readings, expected at least five`);
  } else if (rail.some((reading) => !reading.label || !reading.value)) {
    const bare = rail.filter((reading) => !reading.label || !reading.value).length;
    fail(`${bare} status reading(s) carry a value with no label, or a label with no value`);
  } else {
    pass(`status rail reads ${rail.map((reading) => reading.label).join(', ')}`);
  }

  // Readiness, from the document rather than from an assumption about which
  // chain is currently healthy.
  const reasons = seen.notReadyReasons ?? [];
  if (envelope.ready === false) {
    const explained = reasons.filter(looksLikeAnExplanation);
    if (!explained.length) {
      fail(`${name} reports itself not ready and the page gives no explanation a reader could act on`);
    } else {
      pass(`not ready, and says why in ${explained.length} sentence(s)`);
    }
  } else if (reasons.length) {
    fail(`${name} reports itself ready while the page still shows a fault explanation`);
  } else {
    pass('ready, and shows no fault explanation');
  }

  // Coverage: the live answer to how much history is readable, which is a
  // different question from which lookups exist, and was dropped once while
  // the page went on saying address history was offered. The dashboard files
  // it in the capability drawer, which is where a reader is sent for it.
  const coverage = seen.coverage ?? [];
  const declared = envelope.coverage ?? {};
  if (coverage.length !== 3) {
    fail(`the page states ${coverage.length} history coverage dimensions, expected three`);
  } else if (coverage.some((reading) => !reading.label || !reading.state)) {
    fail('a history coverage reading has no label or no state');
  } else if (
    declared.addressHistory === 'unavailable' &&
    !coverage.some(
      (reading) => /address/i.test(reading.label) && /unavailable/i.test(reading.state),
    )
  ) {
    fail('the document says address history is unavailable and the page does not say so');
  } else {
    pass(
      `history coverage reads ${coverage.map((reading) => `${reading.label} ${reading.state}`).join(', ')}`,
    );
  }

  // The identifier the page rendered is not always the one the run read a
  // moment earlier: a new pending snapshot is taken every few seconds and each
  // has its own identifier. So the exact value is used for the assertion that
  // can only be made about it, that it is not in the primary interface, and the
  // shape is used for the assertion about the page, that an identifier of that
  // shape is filed, whole, under the technical details.
  const snapshotId = envelope.mempool?.snapshotId ?? null;
  if (snapshotId) {
    const shape = snapshotIdentifierShape(snapshotId);
    if (seen.primary.includes(snapshotId) || carriesWholeSnapshotIdentifier(seen.primary, shape)) {
      fail(
        `a whole snapshot identifier is in the primary interface, where ${snapshotId} used to be the widest thing on the page`,
      );
    } else if (!carriesWholeSnapshotIdentifier(seen.disclosure ?? '', shape)) {
      fail(
        'no snapshot identifier appears in the technical details, so the evidence was dropped rather than filed',
      );
    } else {
      pass('the snapshot identifier is filed under the technical details, whole');
    }
  } else {
    pass('this chain reports no pending snapshot identifier');
  }

  // Release identity. The document is checked because that is where the value
  // comes from, and the rendered page because that is what a reader saw.
  const releaseSha = envelope.release?.sha;
  if (releaseSha === PLACEHOLDER_RELEASE || !COMMIT_SHA.test(String(releaseSha ?? ''))) {
    fail(
      `the capability document names its release as ${JSON.stringify(releaseSha ?? null)}, which is not a commit`,
    );
  } else if (seen.primary.includes(releaseSha)) {
    fail('a component release identifier is in the primary interface rather than the technical details');
  } else {
    pass(`overlay release ${releaseSha}`);
  }

  for (const phrase of OBSOLETE_DASHBOARD_PHRASES) {
    if (seen.primary.includes(phrase) || (seen.disclosure ?? '').includes(phrase)) {
      fail(`the page still says ${JSON.stringify(phrase)}, which belongs to the dashboard this replaced`);
    }
  }

  // What makes this chain itself, rather than the other one with a name
  // swapped in. Compared without case, because the words arrive as labels the
  // stylesheet may set in capitals ("Shielded" heads a lens) and innerText
  // reports what is rendered.
  for (const truth of CHAIN_TRUTHS[chain] ?? []) {
    if (!seen.primary.toLowerCase().includes(truth.needle.toLowerCase())) {
      fail(`the page does not state ${truth.id}, which is part of what ${name} does differently`);
    } else {
      pass(`states ${truth.id}`);
    }
  }
  // A chain that offers no projected blocks must say so. The dashboard says it
  // where capability answers live, in the drawer's "Projected blocks: Not
  // offered" row; older copy said it in the primary text, and either counts.
  if (
    envelope.reads?.projectedBlocks !== true &&
    !/projected block/i.test(seen.primary) &&
    !/projected blocks?\s*not offered/i.test(seen.disclosure ?? '')
  ) {
    fail('this chain offers no projected blocks and the page never says so');
  }

  // Next actions: real destinations, named, and reachable. The dashboard's
  // panel links each sit under the panel that describes them, so the link's
  // own text is what has to be there. Reachability is measured by the runner
  // and passed in, because it needs the network.
  const entries = seen.entries ?? [];
  if (entries.length < 2) {
    fail(`the page offers ${entries.length} next action(s), expected at least two`);
  }
  for (const entry of entries) {
    if (!entry.title) {
      fail(`a next action has no visible text: ${JSON.stringify(entry)}`);
      continue;
    }
    if (!entry.href?.startsWith(`/${chain}/`)) {
      fail(
        `the next action ${JSON.stringify(entry.title)} points at ${JSON.stringify(entry.href ?? null)}, which is not a ${name} route`,
      );
      continue;
    }
    const status = observations.entryStatus?.[entry.href];
    if (status === undefined) {
      continue;
    }
    if (status >= 400) {
      fail(`the next action ${entry.href} answered HTTP ${status}`);
    } else {
      pass(`next action ${entry.href} resolves`);
    }
  }

  if (seen.horizontalOverflow > 0) {
    fail(`the page scrolls sideways by ${seen.horizontalOverflow} pixels at 1440`);
  }

  const consoleErrors = observations.consoleErrors ?? [];
  const failedRequests = observations.failedRequests ?? [];
  const foreignRequests = observations.foreignRequests ?? [];
  if (consoleErrors.length) {
    fail(`${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`);
  }
  if (failedRequests.length) {
    fail(`${failedRequests.length} failed request(s): ${failedRequests.slice(0, 3).join(' | ')}`);
  }
  if (foreignRequests.length) {
    fail(
      `the page requested ${foreignRequests.length} third-party address(es): ${foreignRequests.slice(0, 3).join(' | ')}`,
    );
  }

  return { failures, notes };
}

/**
 * The two sentences the timeline prints when a side is honestly empty.
 *
 * An empty side that says one of these is an early state, not a defect: the
 * block collector has not caught up yet, or the pending set really is clear.
 * An empty side that says nothing is absence dressed as data, and that is the
 * defect these words tell apart.
 */
export const TIMELINE_EMPTY_COPY = {
  confirmed: 'No recent blocks are stored yet',
  future: 'Nothing is waiting right now',
};

/**
 * What the rebuilt dashboard has to be true about, beyond what auditChainPage
 * already holds it to.
 *
 * The state this exists to catch is a chain route that answers 200, renders a
 * page, and the page is the capability report the dashboard replaced: no
 * timeline, no panels, just headings about what the chain can answer. That
 * page passes every network-level check, so the assertions here are
 * structural: a timeline was drawn, its populated cubes name their heights,
 * and an empty side explains itself in the timeline's own words rather than
 * standing there bare.
 */
export function auditDashboardParity(chain, collected) {
  const scope = `dashboard:${chain}`;
  const failures = [];
  const notes = [];
  const fail = (message) => failures.push(`${scope}: ${message}`);
  const pass = (message) => notes.push(`${scope}: ${message}`);

  const headings = collected.headings ?? [];
  const timeline = collected.timeline ?? { present: false };

  if (!timeline.present) {
    // The two absences are told apart because they mean different things: the
    // first is the old build still on the origin, the second is the new build
    // losing its own timeline.
    if (headings.some((heading) => heading.includes('Questions this chain can answer'))) {
      fail(
        'the page leads with the capability report and draws no timeline, so the origin serves the page this dashboard replaced',
      );
    } else {
      fail('the block timeline region is absent, so this is not the rebuilt dashboard');
    }
  } else {
    const future = timeline.futureCubes ?? 0;
    const confirmed = timeline.confirmedCubes ?? 0;
    const emptySides = timeline.emptySides ?? [];
    const explains = (copy) => emptySides.some((text) => text.includes(copy));
    if (future === 0 && confirmed === 0) {
      fail('the timeline has zero cubes on both sides, which is a drawn strip with nothing behind it');
    } else {
      pass(`timeline shows ${future} future slot(s) and ${confirmed} confirmed block(s)`);
      for (const [side, count] of [['future', future], ['confirmed', confirmed]]) {
        if (count > 0) {
          continue;
        }
        if (explains(TIMELINE_EMPTY_COPY[side])) {
          pass(`the ${side} side is empty and says so in its own words, an honest early state`);
        } else {
          fail(`the ${side} side is empty and gives no reason, so absence reads as data`);
        }
      }
      if (timeline.heightsAboveCubes === false) {
        fail('a populated cube carries no height label, so a reader cannot tell which block a cube stands for');
      } else {
        pass('every populated cube carries its height label');
      }
    }
    if (timeline.hasDivider) {
      pass('the timeline carries its divider');
    }
  }

  const panels = collected.panels ?? [];
  if (panels.length) {
    pass(`panels read ${panels.join(', ')}`);
  }

  const consoleErrors = collected.consoleErrors ?? [];
  const failedRequests = collected.failedRequests ?? [];
  if (consoleErrors.length) {
    fail(`${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`);
  }
  if (failedRequests.length) {
    fail(`${failedRequests.length} failed request(s): ${failedRequests.slice(0, 3).join(' | ')}`);
  }

  return { failures, notes };
}

/** The path segment each section lives under, so a redirect can be told from a render. */
const SECTION_SEGMENTS = { mining: 'mining', graphs: 'graphs', docs: 'docs' };

/**
 * What a section route has to be true about: it stayed where it was sent, it
 * rendered its own content rather than a fallback, and it did so cleanly.
 *
 * The redirect check comes first because it explains the others. A mining
 * route that bounces to the dashboard renders a perfectly healthy page with
 * no mining heading, and without the final path the finding would blame the
 * heading when the route is what moved.
 */
export function auditSectionPage(chain, section, collected) {
  const scope = `${section}:${chain}`;
  const failures = [];
  const notes = [];
  const fail = (message) => failures.push(`${scope}: ${message}`);
  const pass = (message) => notes.push(`${scope}: ${message}`);

  const expected = `/${chain}/${SECTION_SEGMENTS[section] ?? section}`;
  const finalPath = collected.finalPath ?? '';
  if (finalPath !== expected && !finalPath.startsWith(`${expected}/`)) {
    fail(
      `the browser ended at ${JSON.stringify(finalPath || null)} instead of under ${expected}, so the route redirected away`,
    );
  } else {
    pass(`stays at ${finalPath}`);
  }

  const headings = collected.headings ?? [];
  if (section === 'mining') {
    if (headings.some((heading) => heading.toLowerCase().includes('mining'))) {
      pass('renders its own mining heading');
    } else {
      fail('no heading names mining, so the mining page did not render its own content');
    }
  } else if (section === 'graphs') {
    const links = collected.chartNavLinks ?? 0;
    if (links > 0) {
      pass(`the chart shell offers ${links} chart page link(s)`);
    } else {
      fail('the chart shell navigation is absent, so the graphs page did not render');
    }
  } else if (section === 'docs') {
    const sections = collected.docsSections ?? 0;
    const links = collected.docsNavLinks ?? 0;
    if (sections > 0 && links > 0) {
      pass(`the docs render ${sections} section(s) behind a ${links}-entry section list`);
    } else {
      fail(
        `the docs page renders ${sections} section(s) and ${links} section link(s), so the docs did not render`,
      );
    }
  }

  const consoleErrors = collected.consoleErrors ?? [];
  const failedRequests = collected.failedRequests ?? [];
  if (consoleErrors.length) {
    fail(`${consoleErrors.length} console error(s): ${consoleErrors.slice(0, 3).join(' | ')}`);
  }
  if (failedRequests.length) {
    fail(`${failedRequests.length} failed request(s): ${failedRequests.slice(0, 3).join(' | ')}`);
  }

  return { failures, notes };
}
