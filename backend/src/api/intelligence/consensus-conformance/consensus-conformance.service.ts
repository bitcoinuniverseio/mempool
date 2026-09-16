import { harnessDigest } from './conformance-pins';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { ConformanceStore, ConformanceEvidenceError, digest } from './conformance-evidence';
import { readManifest, verifyEnginePins, ConformanceManifest } from './conformance-manifest';
import { IsolatedCore, parserCorpus, runCorpus } from './conformance-runner';
export { ConformanceEvidenceError } from './conformance-evidence';
const TARGETS = ['transaction_parse', 'block_parse', 'script_verify', 'compact_size'];
const scope = (t: string) =>
  t === 'script_verify'
    ? 'Selected-input btcd StandardVerifyFlags versus isolated Core mempool policy. Not full consensus equivalence.'
    : 'Bounded deserialization and structural checks. Parsing does not establish consensus validity.';
const normalize = (rows: any[]) =>
  rows.map((o) => ({
    implementation_id: o.implementation_id,
    status: o.status,
    ...(o.status === 'accepted'
      ? Object.fromEntries(
          [
            'txid',
            'wtxid',
            'value',
            'block_hash',
            'merkle_root_matches',
            'witness_commitment_matches',
            'pow_matches_embedded_target',
          ]
            .filter((k) => o[k] !== undefined)
            .map((k) => [k, o[k]])
        )
      : {}),
  }));
export class ConsensusConformanceService {
  private manifest: ConformanceManifest | null = null;
  private store: ConformanceStore | null = null;
  private loadError = false;
  private busy = false;
  private state: any = { schema: 'conformance-state-v1', campaigns: [], cases: [], replays: [] };
  constructor(path = process.env.UNIVERSE_CONFORMANCE_MANIFEST) {
    if (!path) return;
    try {
      this.manifest = readManifest(path);
      this.store = new ConformanceStore(
        join(this.manifest.artifact_directory, 'campaigns.json.gz'),
        this.manifest.authentication_key_file
      );
      const s = this.store.read();
      if (s) {
        this.validate(s);
        this.state = s;
        for (const c of s.campaigns)
          if (c.status === 'running') {
            c.status = 'interrupted';
            c.error = 'Process stopped before a durable completed result.';
          }
      }
    } catch {
      this.loadError = true;
      this.store?.close();
      this.store = null;
    }
  }
  private validate(s: any) {
    const fail = () => {
      throw new ConformanceEvidenceError(
        'invalid-campaign-state',
        'Authenticated campaign state violates schema or bounds.'
      );
    };
    if (
      s?.schema !== 'conformance-state-v1' ||
      !Array.isArray(s.campaigns) ||
      !Array.isArray(s.cases) ||
      !Array.isArray(s.replays) ||
      s.campaigns.length > 20 ||
      s.cases.length > 640 ||
      s.replays.length > 64
    )
      fail();
    const ids = new Set();
    for (const c of s.campaigns) {
      if (
        !/^[0-9a-f-]{36}$/.test(c.campaign_id) ||
        ids.has(c.campaign_id) ||
        !TARGETS.includes(c.target_id) ||
        !Number.isSafeInteger(c.seed) ||
        c.seed < 0 ||
        !['running', 'completed', 'failed', 'interrupted'].includes(c.status)
      )
        fail();
      ids.add(c.campaign_id);
    }
    const caseIds = new Set();
    for (const c of s.cases) {
      if (
        typeof c.case_id !== 'string' ||
        caseIds.has(c.case_id) ||
        !ids.has(c.campaign_id) ||
        !TARGETS.includes(c.target) ||
        typeof c.input?.hex !== 'string' ||
        !/^([a-f0-9]{2})*$/i.test(c.input.hex) ||
        c.input.hex.length > 8192 ||
        c.input_sha256 !== digest(JSON.stringify(c.input)) ||
        !Array.isArray(c.implementation_outcomes) ||
        c.implementation_outcomes.length < 2 ||
        c.implementation_outcomes.length > 3
      )
        fail();
      for (const o of c.implementation_outcomes)
        if (
          !['bitcoin-core', 'rust-bitcoin', 'bitcoinjs', 'btcd'].includes(o.implementation_id) ||
          !['accepted', 'rejected', 'unsupported'].includes(o.status) ||
          !Number.isFinite(o.execution_time_ms) ||
          o.execution_time_ms < 0
        )
          fail();
      caseIds.add(c.case_id);
    }
    for (const r of s.replays)
      if (!caseIds.has(r.case_id) || typeof r.reproduced !== 'boolean' || !Array.isArray(r.implementation_outcomes))
        fail();
  }
  private ready() {
    if (this.loadError)
      throw new ConformanceEvidenceError(
        'campaign-state-unavailable',
        'Operator campaign storage or manifest failed validation.'
      );
    if (!this.manifest || !this.store)
      throw new ConformanceEvidenceError(
        'unavailable-runner',
        'Configure pinned isolated engines and authenticated artifact storage before execution.'
      );
  }
  authorizeExecution(token: unknown) {
    this.ready();
    if (typeof token !== 'string' || token.length > 256 || digest(token) !== this.manifest!.execution_token_sha256)
      throw new ConformanceEvidenceError(
        'operator-authentication-required',
        'An operator execution token is required for isolated campaigns and replay.',
        403
      );
  }
  private persist() {
    return this.store!.write(this.state);
  }
  listTargets() {
    return {
      targets: TARGETS.map((target_id) => ({
        target_id,
        name: target_id.replace(/_/g, ' '),
        description: scope(target_id),
        input_schema: 'Repository deterministic bounded corpus v1',
        consensus_critical: false,
        implementations_supported_count: target_id === 'transaction_parse' ? 3 : 2,
      })),
    };
  }
  listImplementations() {
    let implementations: any[] = [];
    let availability = this.loadError ? 'storage-invalid' : 'not-configured';
    if (this.manifest && !this.loadError) {
      try {
        implementations = verifyEnginePins(this.manifest);
        availability = 'pins-verified';
      } catch {
        availability = 'pin-verification-failed';
      }
    }
    return { implementations, availability };
  }
  private readable() {
    if (this.loadError) throw new ConformanceEvidenceError('campaign-state-unavailable', 'Operator campaign storage or manifest failed validation.');
  }
  listCampaigns() {
    this.readable();
    return { campaigns: structuredClone(this.state.campaigns) };
  }
  listCases() {
    this.readable();
    return { cases: structuredClone(this.state.cases) };
  }
  getCase(id: string) {
    this.readable();
    return structuredClone(this.state.cases.find((c) => c.case_id === id));
  }
  listFormalArtifacts() {
    return { formal_artifacts: [], availability: 'No machine-checked formal proof artifacts executed by this runner.' };
  }
  getOverview() {
    const { implementations, availability } = this.listImplementations();
    return {
      total_implementations_evaluated: new Set(
        this.state.cases.flatMap((c) => c.implementation_outcomes.map((o) => o.implementation_id))
      ).size,
      total_consensus_targets: 4,
      total_differential_cases: this.state.cases.length,
      divergences_classified_count: this.state.cases.filter((c) => c.has_difference).length,
      machine_proved_formal_theorems_count: 0,
      implementations,
      targets: this.listTargets().targets,
      recent_cases: structuredClone(this.state.cases.slice(-20)),
      formal_artifacts: [],
      availability,
      scope: 'Authenticated bounded local evidence; not full consensus certification.',
      unsupported_acceptance: [
        'Full chain-context block acceptance differential',
        'Sustained coverage-guided fuzzing and automatic minimization',
        'OS/container sandbox isolation',
        'Machine-checked formal theorem execution',
        'Distributed campaign scheduling',
      ],
    };
  }
  async startCampaign(target: string, seed: number) {
    if (!TARGETS.includes(target) || !Number.isSafeInteger(seed) || seed < 0)
      throw new ConformanceEvidenceError(
        'invalid-campaign',
        'Unknown target or invalid nonnegative safe-integer seed.',
        400
      );
    this.ready();
    if (this.busy)
      throw new ConformanceEvidenceError('runner-busy', 'One campaign or replay may execute at a time.', 429);
    if (this.state.campaigns.length >= 20 || this.state.cases.length + 32 > 640)
      throw new ConformanceEvidenceError(
        'artifact-capacity',
        'Bounded storage capacity reached; operator archival required.',
        429
      );
    this.busy = true;
    let core: IsolatedCore | undefined;
    const c: any = {
      campaign_id: randomUUID(),
      target_id: target,
      seed,
      status: 'running',
      total_inputs_evaluated: 0,
      divergences_found: 0,
      crashes_detected: 0,
      started_at_utc: new Date().toISOString(),
      scope: scope(target),
    };
    try {
      c.engine_pins = verifyEnginePins(this.manifest!);
      c.harness_sha256 = harnessDigest();
      this.state.campaigns.push(c);
      await this.persist();
      if (target !== 'compact_size') {
        core = new IsolatedCore(this.manifest!, join(this.manifest!.artifact_directory, 'runs', c.campaign_id, 'node'));
        await core.start();
      }
      const inputs =
        target === 'script_verify'
          ? await core!.scriptCorpus()
          : parserCorpus(
              target,
              seed,
              target === 'block_parse'
                ? await core!.rpc('getblock', [await core!.rpc('getblockhash', [0]), 0])
                : undefined
            );
      c.corpus_sha256 = digest(JSON.stringify(inputs));
      const rows = await runCorpus(this.manifest!, target, inputs, core);
      for (const row of rows) {
        const difference =
          new Set(
            normalize(row.outcomes).map((o) =>
              JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'implementation_id')))
            )
          ).size > 1;
        const expectations = Object.entries(row.input.expected ?? {}).map(([id, expected]) => ({
          implementation_id: id,
          expected,
          actual: row.outcomes.find((o) => o.implementation_id === id)?.status,
          passed: row.outcomes.find((o) => o.implementation_id === id)?.status === expected,
        }));
        this.state.cases.push({
          case_id: c.campaign_id + ':' + row.input.id,
          campaign_id: c.campaign_id,
          target,
          title: row.input.title,
          input: row.input,
          input_sha256: digest(JSON.stringify(row.input)),
          input_hex_sample: row.input.hex,
          original_size_bytes: row.input.hex.length / 2,
          minimized_size_bytes: null,
          minimization_performed: false,
          implementation_outcomes: row.outcomes,
          has_difference: difference,
          mismatch_class: difference
            ? target === 'script_verify'
              ? 'policy_difference'
              : 'parse_acceptance_difference'
            : 'none',
          severity: 'unassessed',
          scope: scope(target),
          expectations,
          created_at_utc: new Date().toISOString(),
          quarantine_status: 'public',
          reproduction_command: 'POST cases/' + encodeURIComponent(c.campaign_id + ':' + row.input.id) + '/replay',
        });
      }
      const cases = this.state.cases.filter((r) => r.campaign_id === c.campaign_id);
      c.total_inputs_evaluated = rows.length;
      c.divergences_found = cases.filter((r) => r.has_difference).length;
      c.expectation_failures = cases.flatMap((r) => r.expectations).filter((r) => !r.passed).length;
      c.status = 'completed';
      c.completed_at_utc = new Date().toISOString();
      await this.persist();
      return structuredClone(c);
    } catch (e) {
      if (this.state.campaigns.includes(c)) {
        c.status = 'failed';
        c.crashes_detected = null;
        c.error = e instanceof ConformanceEvidenceError ? e.code : 'runner-failed';
        await this.persist();
      }
      throw e instanceof ConformanceEvidenceError
        ? e
        : new ConformanceEvidenceError('runner-failed', 'Campaign failed; successful completion is not claimed.');
    } finally {
      try { await core?.close(); } finally { this.busy = false; }
    }
  }
  async replayCase(id: string) {
    this.ready();
    const record = this.state.cases.find((c) => c.case_id === id);
    if (!record) throw new ConformanceEvidenceError('case-not-found', 'Authenticated case not found.', 404);
    if (this.busy || this.state.replays.length >= 64)
      throw new ConformanceEvidenceError('runner-busy', 'Runner busy or replay capacity reached.', 429);
    this.busy = true;
    let core: IsolatedCore | undefined;
    try {
      const pins = verifyEnginePins(this.manifest!);
      const campaign = this.state.campaigns.find((c) => c.campaign_id === record.campaign_id);
      if (campaign.harness_sha256 !== harnessDigest())
        throw new ConformanceEvidenceError(
          'replay-harness-mismatch',
          'Replay harness differs from authenticated campaign.'
        );
      if (digest(JSON.stringify(pins)) !== digest(JSON.stringify(campaign.engine_pins)))
        throw new ConformanceEvidenceError(
          'replay-engine-mismatch',
          'Replay engine pins differ from authenticated campaign.'
        );
      if (record.input_sha256 !== digest(JSON.stringify(record.input)))
        throw new ConformanceEvidenceError('artifact-authentication-failed', 'Case input authentication mismatch.');
      if (record.target === 'transaction_parse' || record.target === 'script_verify') {
        core = new IsolatedCore(
          this.manifest!,
          join(this.manifest!.artifact_directory, 'runs', record.campaign_id, 'node')
        );
        await core.start();
      }
      const [row] = await runCorpus(this.manifest!, record.target, [record.input], core);
      const replay = {
        replay_id: randomUUID(),
        case_id: id,
        replayed_at_utc: new Date().toISOString(),
        reproduced:
          JSON.stringify(normalize(row.outcomes)) === JSON.stringify(normalize(record.implementation_outcomes)),
        implementation_outcomes: row.outcomes,
        scope: record.scope,
      };
      this.state.replays.push(replay);
      await this.persist();
      return structuredClone(replay);
    } finally {
      try { await core?.close(); } finally { this.busy = false; }
    }
  }
  close() {
    if (this.busy) throw Error('Cannot close active runner');
    this.store?.close();
  }
}
export default new ConsensusConformanceService();
