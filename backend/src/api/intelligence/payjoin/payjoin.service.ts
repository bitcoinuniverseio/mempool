import * as crypto from 'crypto';
import * as https from 'https';
import { Psbt } from 'bitcoinjs-lib';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { IdentityError, resolvePublicAddress, validateWebhookUrl } from '../identity/developer-identity';
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
  constructor(public readonly code: string, message: string, public readonly status = 503) { super(message); }
}

export type DirectoryProber = (url: URL, address: string) => Promise<{ ok: boolean; status: number | null; body: Buffer | null; latency_ms: number | null; error: string | null }>;

const defaultProber: DirectoryProber = (url, address) => new Promise(resolve => {
  const started = Date.now();
  const request = https.request({ host: address, servername: url.hostname, port: url.port ? Number(url.port) : 443, path: `${url.pathname.replace(/\/$/, '')}/ohttp-keys`, method: 'GET', headers: { host: url.host }, timeout: 5000 }, response => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 8192) { chunks.push(chunk); } });
    response.on('end', () => resolve({ ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300, status: response.statusCode ?? null, body: Buffer.concat(chunks), latency_ms: Date.now() - started, error: null }));
  });
  request.on('timeout', () => { request.destroy(new Error('timeout')); });
  request.on('error', error => resolve({ ok: false, status: null, body: null, latency_ms: null, error: (error as NodeJS.ErrnoException).code ?? error.message }));
  request.end();
});

interface PsbtView {
  inputs: { outpoint: string; value: number | null }[];
  outputs: { script: string; value: number }[];
  fee: number | null;
  vsize: number | null;
}

function view(psbt: Psbt): PsbtView {
  const inputs = psbt.txInputs.map((input, index) => {
    const data = psbt.data.inputs[index];
    let value: number | null = null;
    if (data.witnessUtxo) { value = Number(data.witnessUtxo.value); }
    else if (data.nonWitnessUtxo) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Transaction } = require('bitcoinjs-lib');
        value = Number(Transaction.fromBuffer(data.nonWitnessUtxo).outs[input.index].value);
      } catch { value = null; }
    }
    return { outpoint: `${Buffer.from(input.hash).reverse().toString('hex')}:${input.index}`, value };
  });
  const outputs = psbt.txOutputs.map(output => ({ script: Buffer.from(output.script).toString('hex'), value: Number(output.value) }));
  const inputTotal = inputs.every(input => input.value !== null) ? inputs.reduce((sum, input) => sum + (input.value as number), 0) : null;
  const fee = inputTotal === null ? null : inputTotal - outputs.reduce((sum, output) => sum + output.value, 0);
  let vsize: number | null = null;
  try { vsize = psbt.extractTransaction(true).virtualSize(); } catch { vsize = null; }
  return { inputs, outputs, fee, vsize };
}

export class PayjoinService {
  private static instance: PayjoinService;
  private playgroundSessions = new Map<string, PayjoinPlaygroundSession>();
  private directoryCache: { at: number; directories: PayjoinDirectory[] } | null = null;
  public prober: DirectoryProber = defaultProber;
  public configuredDirectories: () => string[] = () => (process.env[DIRECTORIES_ENV] ?? '').split(',').map(value => value.trim()).filter(Boolean);

  private compatibilityCatalog: PayjoinCompatibilityEntry[] = [
    { software: 'BTCPay Server', role: 'receiver', bip78_v1_http: true, bip77_v2_ohttp: true, status: 'production', notes: 'Full BIP78 server with optional OHTTP directory support' },
    { software: 'Sparrow Wallet', role: 'both', bip78_v1_http: true, bip77_v2_ohttp: false, status: 'production', notes: 'Desktop sender and receiver support with Tor support' },
    { software: 'Wasabi Wallet', role: 'sender', bip78_v1_http: true, bip77_v2_ohttp: false, status: 'production', notes: 'Automatic Payjoin sending during coinjoin transactions' },
    { software: 'JoinMarket', role: 'both', bip78_v1_http: true, bip77_v2_ohttp: false, status: 'production', notes: 'Pioneered collaborative transaction structures' },
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
      active_directories_count: directories.filter(directory => directory.bip77_supported).length,
      configured_directories_count: directories.length,
      // No payjoin detector runs on this deployment; a count would be a guess.
      total_payjoins_detected_24h: null,
      common_input_heuristic_breaks_24h: null,
      compatibility_catalog: this.compatibilityCatalog,
      compatibility_source: 'reference catalog maintained in this repository; not probed',
      last_updated: new Date().toISOString(),
    };
  }

  /** @asyncUnsafe Configured directories, each probed for its OHTTP keys with a short cache. */
  public async getDirectories(now = Date.now()): Promise<PayjoinDirectory[]> {
    if (this.directoryCache && now - this.directoryCache.at < 5 * 60_000) { return this.directoryCache.directories; }
    const configured = this.configuredDirectories();
    if (configured.length === 0) {
      throw new PayjoinUnavailableError('unavailable-payjoin-directories', `No payjoin directory is configured on this deployment (${DIRECTORIES_ENV}); directory reachability and OHTTP keys cannot be reported.`);
    }
    const directories: PayjoinDirectory[] = [];
    for (const raw of configured) {
      let url: URL;
      try { url = validateWebhookUrl(raw); } catch (error) {
        directories.push({ directory_id: `dir-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)}`, url: raw, ohttp_key_hash: null, bip77_supported: false, bip78_supported: false, latency_ms: null, last_tested_at: new Date(now).toISOString(), error: error instanceof IdentityError ? error.message : 'invalid url' });
        continue;
      }
      let probe: Awaited<ReturnType<DirectoryProber>>;
      try {
        const pinned = await resolvePublicAddress(url);
        probe = await this.prober(url, pinned.address);
      } catch (error) {
        probe = { ok: false, status: null, body: null, latency_ms: null, error: error instanceof Error ? error.message : String(error) };
      }
      directories.push({
        directory_id: `dir-${crypto.createHash('sha256').update(url.toString()).digest('hex').slice(0, 12)}`, url: url.toString(),
        ohttp_key_hash: probe.ok && probe.body ? crypto.createHash('sha256').update(probe.body).digest('hex') : null,
        bip77_supported: probe.ok, bip78_supported: probe.ok, latency_ms: probe.latency_ms, last_tested_at: new Date(now).toISOString(), error: probe.error ?? (probe.ok ? null : `http ${probe.status}`),
      });
    }
    this.directoryCache = { at: now, directories };
    return directories;
  }

  public getCompatibility(): PayjoinCompatibilityEntry[] {
    return this.compatibilityCatalog;
  }

  private static parse(encoded: string, label: string): Psbt {
    const trimmed = String(encoded ?? '').trim();
    if (!trimmed) { throw new Error(`${label} is required`); }
    try { return /^[0-9a-fA-F]+$/.test(trimmed) ? Psbt.fromHex(trimmed) : Psbt.fromBase64(trimmed); }
    catch { throw new Error(`${label} is not a valid PSBT (base64 or hex)`); }
  }

  /** Compares the original and the proposal transaction by their inputs and outputs. */
  public analyzeProposal(req: PayjoinProposalAnalysisRequest): PayjoinProposalAnalysisResult {
    if (!req.original_psbt || !req.proposal_psbt) {
      throw new Error('Both original_psbt and proposal_psbt are required for comparison.');
    }
    const original = view(PayjoinService.parse(req.original_psbt, 'original_psbt'));
    const proposal = view(PayjoinService.parse(req.proposal_psbt, 'proposal_psbt'));
    const messages: string[] = [];
    const originalOutpoints = new Set(original.inputs.map(input => input.outpoint));
    const addedInputs = proposal.inputs.filter(input => !originalOutpoints.has(input.outpoint));
    const missingInputs = original.inputs.filter(input => !proposal.inputs.some(candidate => candidate.outpoint === input.outpoint));
    if (missingInputs.length) { messages.push(`Proposal dropped ${missingInputs.length} of the sender's original inputs; BIP78 requires them all to stay.`); }
    const receiverSats = addedInputs.every(input => input.value !== null) ? addedInputs.reduce((sum, input) => sum + (input.value as number), 0) : null;
    if (addedInputs.length && receiverSats === null) { messages.push('Receiver inputs carry no UTXO data, so the contributed amount cannot be computed.'); }
    const removedOutputs = original.outputs.filter(output => !proposal.outputs.some(candidate => candidate.script === output.script));
    if (removedOutputs.length) { messages.push(`Proposal removed ${removedOutputs.length} original output(s).`); }
    const changedOutputs = original.outputs.filter(output => { const match = proposal.outputs.find(candidate => candidate.script === output.script); return match && match.value !== output.value; });
    const feeDelta = original.fee !== null && proposal.fee !== null ? proposal.fee - original.fee : null;
    if (feeDelta !== null && feeDelta < 0) { messages.push('Proposal pays less fee than the original.'); }
    const heuristics: string[] = [];
    if (addedInputs.length > 0) { heuristics.push('Common-Input-Ownership Heuristic (CIOH)'); }
    if (changedOutputs.length > 0) { heuristics.push('Payment-Amount Heuristic'); }
    const valid = missingInputs.length === 0 && removedOutputs.length === 0 && (feeDelta === null || feeDelta >= 0);
    if (addedInputs.length === 0) { messages.push('Proposal adds no receiver input; it is not a payjoin.'); }
    return {
      analysis_id: EventEnvelopeValidator.generateUuidV7(), protocol_version: 'BIP78',
      inputs_added_by_receiver: addedInputs.length, receiver_contributed_sats: receiverSats,
      original_fee_sats: original.fee, proposal_fee_sats: proposal.fee, fee_delta_sats: feeDelta,
      effective_feerate_sats_vb: proposal.fee !== null && proposal.vsize ? Math.round((proposal.fee / proposal.vsize) * 100) / 100 : null,
      heuristics_broken: heuristics,
      // A count of broken heuristics, not a score; no model is applied.
      privacy_score_gain: heuristics.length,
      is_valid: valid && addedInputs.length > 0,
      validation_messages: messages,
      original: { inputs: original.inputs.length, outputs: original.outputs.length }, proposal: { inputs: proposal.inputs.length, outputs: proposal.outputs.length },
    };
  }

  /** A narrated walkthrough. It builds no transaction and is labelled as a simulation. */
  public createPlaygroundSession(amountSats = 100000): PayjoinPlaygroundSession {
    if (!Number.isFinite(amountSats) || amountSats <= 0 || amountSats > 21e14) { throw new Error('amount_sats must be a positive number'); }
    const session: PayjoinPlaygroundSession = {
      session_id: 'pjs-' + crypto.randomBytes(4).toString('hex'), simulated: true, step: 'original_created',
      sender_address: 'sender (simulated)', receiver_address: 'receiver (simulated)', amount_sats: Math.floor(amountSats), original_txid: null, payjoin_txid: null,
      events_trace: [{ timestamp: new Date().toISOString(), phase: 'Original PSBT Construction', details: 'The sender builds a transaction with its own input(s), the payment output and a change output. Nothing is broadcast in this walkthrough.' }],
    };
    this.playgroundSessions.set(session.session_id, session);
    if (this.playgroundSessions.size > 1000) { const oldest = this.playgroundSessions.keys().next().value; if (oldest) { this.playgroundSessions.delete(oldest); } }
    return session;
  }

  public advancePlaygroundSession(sessionId: string): PayjoinPlaygroundSession {
    const session = this.playgroundSessions.get(sessionId);
    if (!session) { throw new Error('Playground session not found.'); }
    if (session.step === 'original_created') {
      session.step = 'proposal_generated';
      session.events_trace.push({ timestamp: new Date().toISOString(), phase: 'Receiver Payjoin Proposal', details: 'The receiver adds one of its own inputs and raises the payment output by the same amount, so the inputs no longer all belong to one party.' });
    } else if (session.step === 'proposal_generated') {
      session.step = 'signed_and_broadcast';
      session.events_trace.push({ timestamp: new Date().toISOString(), phase: 'Sender Final Signing and Broadcast', details: 'The sender checks the proposal against BIP78 rules, signs its inputs again and broadcasts. This walkthrough performs no signing or broadcast.' });
    }
    return session;
  }
}

export const payjoinService = PayjoinService.getInstance();
