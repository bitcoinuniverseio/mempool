import * as crypto from 'crypto';
import * as https from 'https';
import * as tls from 'tls';
import { parseOhttpDirectoryKeys } from './ohttp-directory-keys';
import { Psbt } from 'bitcoinjs-lib';
import { compareProposal } from './proposal-analysis';
import {
  verifyProposalSignatures,
  verifyFinalProposal,
} from './proposal-signatures';
import { verifyProposalUtxos } from './proposal-utxos';
import { EventEnvelopeValidator } from '../events/event-envelope';
import {
  IdentityError,
  resolvePublicAddress,
  validateWebhookUrl,
} from '../identity/developer-identity';
import {
  PayjoinDirectory,
  PayjoinProposalAnalysisRequest,
  PayjoinProposalAnalysisResult,
  PayjoinCompatibilityEntry,
  PayjoinPlaygroundSession,
  PayjoinOverview,
} from './payjoin.models';

/**
 * Payjoin: directory reachability, proposal analysis, and a labelled walkthrough.
 *
 * The revision this replaces listed two third-party directories with random
 * OHTTP key hashes and invented latencies, counted 312 payjoins a day that
 * nobody detected, and analysed a proposal by comparing string lengths and
 * returning fixed fees. Directories now come from configuration
 * (UNIVERSE_PAYJOIN_DIRECTORIES, comma separated https URLs) and are probed
 * for real; a proposal is parsed as a PSBT and compared input by input and
 * output by output; the playground is a walkthrough that says it is one.
 */

export const DIRECTORIES_ENV = 'UNIVERSE_PAYJOIN_DIRECTORIES';

export class PayjoinUnavailableError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 503
  ) {
    super(message);
  }
}

export type DirectoryProber = (
  url: URL,
  address: string
) => Promise<{
  ok: boolean;
  content_type?: string;
  origin?: string;
  status: number | null;
  body: Buffer | null;
  latency_ms: number | null;
  error: string | null;
}>;

const defaultProber: DirectoryProber = (url, address) =>
  new Promise((resolve) => {
    /* IMPLEMENTATION-HANDOFF [WP-BI-006] DEF-BI-006; COV-BI-006A/B/C.
     * Verified: this probe uses /ohttp-keys, omits media-type evidence and treats any
     * 2xx body as success; getDirectories then declares both BIP77 and BIP78 support.
     * Governing sources: BIP77 draft 0.2.0 at bitcoin/bips 927b6de9915c9262615a6399de51b200f81e5aa4,
     * RFC9540 sections 5-6 and RFC9458 sections 3.1-3.2. The pinned BIP snapshot is
     * bundled under research/snapshots/bip-0077.md. BIP78 plaintext support is optional.
     * 1. Probe the configured directory's RFC9540 /.well-known/ohttp-gateway with
     *    Accept: application/ohttp-keys; any legacy endpoint requires an explicitly
     *    pinned deployment profile, not an assumed universal path.
     * 2. Return content-type, final authenticated origin, full bounded body and a
     *    typed transport outcome. Abort on excess bytes instead of hashing a truncated
     *    prefix; use an absolute deadline and bounded directory concurrency/singleflight.
     *    Preserve DNS pinning and TLS checks. Redirects, if supported, require fresh
     *    destination checks and the RFC9540 privacy rules, never arbitrary following.
     * 3. Parse/validate the entire RFC9458 length-prefixed key collection and supported
     *    KEM/KDF/AEAD suites in PROPOSED NEW payjoin/ohttp-directory-keys.ts using a
     *    pinned compatible codec. Reject malformed, empty or unsupported collections;
     *    the BIP77 draft's key-fragment ambiguity must be resolved against its selected
     *    implementation profile before adding client encapsulation, never guessed.
     * Dependencies: pinned directory/codec profile, then getDirectories DTO/consumer.
     * Tests: payjoin.test.ts and PROPOSED NEW payjoin/ohttp-directory-keys.test.ts;
     *    RFC vectors, invalid HTML/empty body, wrong content-type, truncation, oversized
     *    body, timeout, DNS/redirect rejection, supported/unsupported suites and rotation.
     * Command after native deps are built: cd backend && ./node_modules/.bin/jest
     *    --runInBand --coverage=false --runTestsByPath src/api/intelligence/payjoin/payjoin.test.ts
     * Full test command was incomplete with absent native artifacts during preparation.
     * Rollback keeps configured URLs but invalidates old unvalidated capability cache;
     *    no production capability may depend on an arbitrary response hash.
     */
    const started = Date.now();
    let settled = false;
    let deadline: NodeJS.Timeout;
    let responseHandle: import('http').IncomingMessage | undefined;
    const finish: typeof resolve = value => { if (!settled) { settled = true; clearTimeout(deadline); resolve(value); } };
    const request = https.request(
      {
        host: address,
        servername: url.hostname,
        port: url.port ? Number(url.port) : 443,
        path: '/.well-known/ohttp-gateway',
        checkServerIdentity: (_hostname, cert) => tls.checkServerIdentity(url.hostname, cert),
        method: 'GET',
        headers: { host: url.host, accept: 'application/ohttp-keys' },
        timeout: 5000,
      },
      (response) => {
        responseHandle = response;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8192) { finish({ ok: false, status: response.statusCode ?? null, body: null, latency_ms: Date.now() - started, error: 'response_too_large' }); response.destroy(); request.destroy(); return; }
          chunks.push(chunk);
        });
        response.on('error', () => finish({ ok: false, status: response.statusCode ?? null, body: null, latency_ms: Date.now() - started, error: 'response_error' }));
        response.on('aborted', () => finish({ ok: false, status: response.statusCode ?? null, body: null, latency_ms: Date.now() - started, error: 'response_aborted' }));
        response.on('end', () =>
          finish({
            ok:
              (response.statusCode ?? 0) >= 200 &&
              (response.statusCode ?? 0) < 300,
            status: response.statusCode ?? null,
            body: Buffer.concat(chunks),
            content_type: String(response.headers['content-type'] ?? ''),
            origin: url.origin,
            latency_ms: Date.now() - started,
            error: null,
          })
        );
      }
    );
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) =>
      finish({
        ok: false,
        status: null,
        body: null,
        latency_ms: null,
        error: (error as NodeJS.ErrnoException).code ?? error.message,
      })
    );
    deadline = setTimeout(() => { finish({ok:false,status:null,body:null,latency_ms:Date.now()-started,error:'timeout'}); request.destroy(); responseHandle?.destroy(); },5000);
    request.end();
  });

export class PayjoinService {
  private static instance: PayjoinService;
  private playgroundSessions = new Map<string, PayjoinPlaygroundSession>();
  private directoryCache: {
    at: number;
    config: string;
    directories: PayjoinDirectory[];
  } | null = null;
  private directoryPending: {key:string;work:Promise<PayjoinDirectory[]>} | null = null;
  public prober: DirectoryProber = defaultProber;
  public configuredDirectories: () => string[] = () =>
    (process.env[DIRECTORIES_ENV] ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

  private compatibilityCatalog: PayjoinCompatibilityEntry[] = [
    {
      software: 'BTCPay Server',
      role: 'receiver',
      bip78_v1_http: true,
      bip77_v2_ohttp: true,
      status: 'production',
      notes: 'Full BIP78 server with optional OHTTP directory support',
    },
    {
      software: 'Sparrow Wallet',
      role: 'both',
      bip78_v1_http: true,
      bip77_v2_ohttp: false,
      status: 'production',
      notes: 'Desktop sender and receiver support with Tor support',
    },
    {
      software: 'Wasabi Wallet',
      role: 'sender',
      bip78_v1_http: true,
      bip77_v2_ohttp: false,
      status: 'production',
      notes: 'Automatic Payjoin sending during coinjoin transactions',
    },
    {
      software: 'JoinMarket',
      role: 'both',
      bip78_v1_http: true,
      bip77_v2_ohttp: false,
      status: 'production',
      notes: 'Pioneered collaborative transaction structures',
    },
  ];

  private constructor() {}

  public static getInstance(): PayjoinService {
    if (!PayjoinService.instance) {
      PayjoinService.instance = new PayjoinService();
    }
    return PayjoinService.instance;
  }

  /** Test seam. */
  public resetForTests(): void {
    this.playgroundSessions.clear();
    this.directoryCache = null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getOverview(): Promise<PayjoinOverview> {
    const directories = await this.getDirectories();
    return {
      active_directories_count: directories.filter(
        (directory) => directory.bip77_supported
      ).length,
      configured_directories_count: directories.length,
      // No payjoin detector runs on this deployment; a count would be a guess.
      total_payjoins_detected_24h: null,
      common_input_heuristic_breaks_24h: null,
      compatibility_catalog: this.compatibilityCatalog,
      compatibility_source:
        'reference catalog maintained in this repository; not probed',
      last_updated: new Date().toISOString(),
    };
  }

  /** @asyncUnsafe Configured directories, each probed for its OHTTP keys with a short cache. */
  public getDirectories(now = Date.now()): Promise<PayjoinDirectory[]> {
    const key=JSON.stringify(this.configuredDirectories());
    if(this.directoryPending?.key===key)return this.directoryPending.work;
    const work=this.refreshDirectories(now).finally(()=>{if(this.directoryPending?.work===work)this.directoryPending=null;});
    this.directoryPending={key,work};return work;
  }
  private async refreshDirectories(now: number): Promise<PayjoinDirectory[]> {
    /* IMPLEMENTATION-HANDOFF [WP-BI-006] DEF-BI-006; COV-BI-006A/B/C.
     * Current-source reproduction: HTTP 200 plus '<html>not OHTTP keys</html>'
     * gives bip77_supported=true, bip78_supported=true and an ohttp_key_hash.
     * 1. Separate reachability, validated OHTTP key configuration and verified
     *    protocol capability in PayjoinDirectory and all overview/UI consumers.
     *    Hash only the complete validated key collection; record pinned profile,
     *    evidence timestamp, key IDs/suites and typed unavailable/invalid reason.
     * 2. A valid OHTTP key establishes key availability, not a full BIP77 workflow.
     *    Require compatible directory behavior evidence before asserting BIP77 support;
     *    keep BIP78 support unknown until independently configured/verified against
     *    its plaintext receiver contract. Never infer it from OHTTP availability.
     * 3. Key the cache by normalized endpoint and protocol profile; coalesce concurrent
     *    refreshes, bound configured entries and invalidate when config/keys change.
     *    Update getOverview active count and frontend directory/compatibility displays
     *    to consume evidence states rather than optimistic booleans.
     * Dependencies: WP-BI-006 prober/codec; BIP77 927b6de... draft 0.2.0, RFC9458/9540.
     * Tests: extend payjoin.test.ts and frontend payjoin component tests. Invalid HTML
     *    must never imply either protocol; valid keys alone leave negotiation unknown;
     *    BIP78 and BIP77 integration cases have separate evidence and failure paths.
     * Existing suite command: cd backend && ./node_modules/.bin/jest --runInBand
     *    --coverage=false --runTestsByPath src/api/intelligence/payjoin/payjoin.test.ts
     * Acceptance: real configured directory discovery, validated keys and truthful
     *    API/UI readback; test offered transaction-analysis paths separately on Signet.
     * Rollback retains URL configuration, clears obsolete cache and preserves truthful
     *    unavailable results. No transfer/signing/broadcast occurred in this preparation.
     */
    if (this.directoryCache && this.directoryCache.config === JSON.stringify(this.configuredDirectories()) && now - this.directoryCache.at < 5 * 60_000) {
      return this.directoryCache.directories;
    }
    const configured = this.configuredDirectories();
    if (configured.length === 0) {
      throw new PayjoinUnavailableError(
        'unavailable-payjoin-directories',
        `No payjoin directory is configured on this deployment (${DIRECTORIES_ENV}); directory reachability and OHTTP keys cannot be reported.`
      );
    }
    const directories: PayjoinDirectory[] = [];
    if (configured.length > 16) throw new PayjoinUnavailableError('directory_limit', 'At most16 directories may be configured');
    for (const raw of configured) {
      let url: URL;
      try {
        url = validateWebhookUrl(raw);
      } catch (error) {
        directories.push({
          directory_id: `dir-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)}`,
          url: raw,
          ohttp_key_hash: null,
          reachable: false, key_config_valid: false, key_ids: [], protocol_profile: 'rfc9458-rfc9540', bip77_state: 'unavailable', bip78_state: 'unknown',
          bip77_supported: false,
          bip78_supported: false,
          latency_ms: null,
          last_tested_at: new Date(now).toISOString(),
          error: error instanceof IdentityError ? error.message : 'invalid url',
        });
        continue;
      }
      let probe: Awaited<ReturnType<DirectoryProber>>;
      try {
        const pinned = await resolvePublicAddress(url);
        probe = await this.prober(url, pinned.address);
      } catch (error) {
        probe = {
          ok: false,
          status: null,
          body: null,
          latency_ms: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      let keyIds: number[] = [];
      let invalid: string | null = null;
      if (probe.ok) {
        try {
          if (probe.content_type?.split(';')[0].trim().toLowerCase() !== 'application/ohttp-keys' || probe.origin !== url.origin || !probe.body) throw new Error('invalid_key_response');
          keyIds = parseOhttpDirectoryKeys(probe.body).map(key => key.key_id);
        } catch (error) { invalid = error instanceof Error ? error.message : 'invalid_key_collection'; }
      }
      directories.push({
        directory_id: `dir-${crypto.createHash('sha256').update(url.toString()).digest('hex').slice(0, 12)}`,
        url: url.toString(),
        ohttp_key_hash:
          keyIds.length > 0 && probe.body
            ? crypto.createHash('sha256').update(probe.body).digest('hex')
            : null,
        reachable: probe.ok, key_config_valid: keyIds.length > 0, key_ids: keyIds, protocol_profile: 'rfc9458-rfc9540',
        bip77_state: keyIds.length ? 'unknown' : 'unavailable', bip78_state: 'unknown',
        bip77_supported: false,
        bip78_supported: false,
        latency_ms: probe.latency_ms,
        last_tested_at: new Date(now).toISOString(),
        error: invalid ?? probe.error ?? (probe.ok ? null : `http ${probe.status}`),
      });
    }
    this.directoryCache = { at: now, config: JSON.stringify(configured), directories };
    return directories;
  }

  public getCompatibility(): PayjoinCompatibilityEntry[] {
    return this.compatibilityCatalog;
  }

  /** Compares the original and the proposal transaction by their inputs and outputs. */
  public analyzeProposal(
    req: PayjoinProposalAnalysisRequest
  ): PayjoinProposalAnalysisResult {
    if (!req.original_psbt || !req.proposal_psbt) {
      throw new Error(
        'Both original_psbt and proposal_psbt are required for comparison.'
      );
    }
    const comparison = compareProposal(req);
    const {
      original,
      proposal,
      addedInputs,
      feeDelta,
      messages,
      envelopeIssues,
    } = comparison;
    const receiverSats = addedInputs.every((input) => input.value !== null)
      ? addedInputs.reduce((sum, input) => sum + input.value!, 0)
      : null;
    const structuralPassed = messages.length === 0;
    const heuristics: string[] = [];
    if (addedInputs.length)
      heuristics.push(
        'Multiple input outpoints; independent ownership is not verified'
      );
    messages.push(...envelopeIssues);
    messages.push(
      'Transaction comparison does not establish signatures, input ownership, current UTXO availability or final signed transaction feerate.'
    );
    return {
      analysis_id: EventEnvelopeValidator.generateUuidV7(),
      protocol_version: 'BIP78',
      inputs_added_by_receiver: addedInputs.length,
      receiver_contributed_sats: receiverSats,
      original_fee_sats: original.fee,
      proposal_fee_sats: proposal.fee,
      fee_delta_sats: feeDelta,
      effective_feerate_sats_vb:
        proposal.fee !== null && proposal.vsize
          ? Math.round((proposal.fee / proposal.vsize) * 100) / 100
          : null,
      heuristics_broken: heuristics,
      // A count of broken heuristics, not a score; no model is applied.
      privacy_score_gain: 0,
      is_valid: structuralPassed && envelopeIssues.length === 0 ? null : false,
      structural_checks_passed: structuralPassed,
      psbt_envelope_checks_passed: envelopeIssues.length === 0,
      signatures_verified: null,
      chain_verified: null,
      verification_scope:
        'PSBT differential and declared sender policy; not signing authorization',
      validation_messages: messages,
      original: {
        inputs: original.inputs.length,
        outputs: original.outputs.length,
      },
      proposal: {
        inputs: proposal.inputs.length,
        outputs: proposal.outputs.length,
      },
    };
  }

  public async analyzeProposalWithSignatures(
    req: PayjoinProposalAnalysisRequest
  ): Promise<PayjoinProposalAnalysisResult> {
    const result = this.analyzeProposal(req);
    if (!result.structural_checks_passed || !result.psbt_envelope_checks_passed)
      return result;
    try {
      const signatures = await verifyProposalSignatures(req);
      result.signatures_verified = signatures.verified;
      result.validation_messages = result.validation_messages.filter(
        (message) =>
          !message.startsWith('Transaction comparison does not establish')
      );
      result.validation_messages.push(...signatures.errors);
      result.validation_messages.push(
        'Original and receiver proposal scripts checked with ' +
          signatures.engine +
          '. Current UTXO availability, final sender signatures and final transaction feerate remain unestablished.'
      );
      result.verification_scope =
        'BIP78 sender comparison and transaction-context script verification against supplied previous outputs';
      if (!signatures.verified) result.is_valid = false;
    } catch {
      result.validation_messages.push(
        'Transaction script verification could not complete. No signature acceptance is established.'
      );
    }
    return result;
  }

  /** @asyncUnsafe rejections propagate to the caller, which handles them. */
  public async analyzeProposalWithOwnedEvidence(
    req: PayjoinProposalAnalysisRequest
  ): Promise<PayjoinProposalAnalysisResult> {
    const result = await this.analyzeProposalWithSignatures(req);
    if (result.signatures_verified !== true) return result;
    try {
      const { verified, ...evidence } = await verifyProposalUtxos(
        compareProposal(req).proposal.inputs
      );
      result.chain_verified = verified;
      result.utxo_evidence = evidence;
      result.validation_messages.push(
        verified
          ? 'Every supplied input matches the current owned UTXO view at the reported checkpoint.'
          : 'At least one input is unavailable, immature or inconsistent with the owned UTXO view.'
      );
      if (!verified) result.is_valid = false;
    } catch {
      result.validation_messages.push(
        'Owned UTXO evidence could not be established. Retry against the configured source; no signing acceptance is established.'
      );
    }
    if (req.final_signed_psbt !== undefined && result.chain_verified === true) {
      try {
        const final = await verifyFinalProposal(req, result.utxo_evidence!.tip);
        result.final_signatures_verified = final.signatures;
        result.node_policy_accepted = final.policy;
        result.final_vsize = final.vsize;
        result.final_feerate_sats_vb = final.feerate;
        result.is_valid = final.signatures && final.policy;
        if (final.error) result.validation_messages.push(final.error);
        else {
          result.validation_messages = result.validation_messages.filter(
            (message) => !message.includes('remain unestablished')
          );
          result.validation_messages.push(
            'The unchanged final transaction has valid input scripts and passes the owned node’s current mempool policy. No broadcast or reservation was performed.'
          );
          result.verification_scope =
            'Declared BIP78 sender policy, all final transaction input scripts, owned current UTXOs and read-only testmempoolaccept';
        }
      } catch (error) {
        result.is_valid = null;
        result.validation_messages.push(
          error instanceof Error
            ? error.message
            : 'Final signed transaction verification did not complete.'
        );
      }
    }
    return result;
  }

  /** A narrated walkthrough. It builds no transaction and is labelled as a simulation. */
  public createPlaygroundSession(
    amountSats = 100000
  ): PayjoinPlaygroundSession {
    if (!Number.isFinite(amountSats) || amountSats <= 0 || amountSats > 21e14) {
      throw new Error('amount_sats must be a positive number');
    }
    const session: PayjoinPlaygroundSession = {
      session_id: 'pjs-' + crypto.randomBytes(4).toString('hex'),
      simulated: true,
      step: 'original_created',
      sender_address: 'sender (simulated)',
      receiver_address: 'receiver (simulated)',
      amount_sats: Math.floor(amountSats),
      original_txid: null,
      payjoin_txid: null,
      events_trace: [
        {
          timestamp: new Date().toISOString(),
          phase: 'Original PSBT Construction',
          details:
            'The sender builds a transaction with its own input(s), the payment output and a change output. Nothing is broadcast in this walkthrough.',
        },
      ],
    };
    this.playgroundSessions.set(session.session_id, session);
    if (this.playgroundSessions.size > 1000) {
      const oldest = this.playgroundSessions.keys().next().value;
      if (oldest) {
        this.playgroundSessions.delete(oldest);
      }
    }
    return session;
  }

  public advancePlaygroundSession(sessionId: string): PayjoinPlaygroundSession {
    const session = this.playgroundSessions.get(sessionId);
    if (!session) {
      throw new Error('Playground session not found.');
    }
    if (session.step === 'original_created') {
      session.step = 'proposal_generated';
      session.events_trace.push({
        timestamp: new Date().toISOString(),
        phase: 'Receiver Payjoin Proposal',
        details:
          'The receiver adds one of its own inputs and raises the payment output by the same amount, so the inputs no longer all belong to one party.',
      });
    } else if (session.step === 'proposal_generated') {
      session.step = 'signed_and_broadcast';
      session.events_trace.push({
        timestamp: new Date().toISOString(),
        phase: 'Sender Final Signing and Broadcast',
        details:
          'The sender checks the proposal against BIP78 rules, signs its inputs again and broadcasts. This walkthrough performs no signing or broadcast.',
      });
    }
    return session;
  }
}

export const payjoinService = PayjoinService.getInstance();
