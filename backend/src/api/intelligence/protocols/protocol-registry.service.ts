import { decodeRunestone, Runestone } from './runestone';
import { InscriptionEnvelope, parseBrc20, parseInscriptionEnvelopes } from './inscription-envelope';
import { hexToBuffer, isPush, OP_RETURN, parseScript } from './script-parser';
import { ProtocolActivityObserver, ProtocolActivityMetrics } from './protocol-activity';
import { OTS_MAGIC } from '../opentimestamps/ots-timestamp';
import { parseDetachedProof } from '../opentimestamps/opentimestamps-proof';

export interface ProtocolAdapterMetadata {
  protocol_id: string;
  name: string;
  category: 'token' | 'layer2' | 'privacy' | 'metadata' | 'smart_contract';
  specification_url: string;
  version: string;
  active: boolean;
  block_height_introduced: number;
  /** What this backend can do for the protocol on its own; anything else needs an authority. */
  capabilities: { decode: boolean; metrics: boolean };
}

/**
 * decoding_level says how much of the result is established by the bytes:
 * marker      only a protocol marker was recognised; nothing else is claimed
 * syntactic   the payload parsed under the protocol's own grammar
 * authority   confirmed by an indexer (never produced by this service)
 */
export type DecodingLevel = 'marker' | 'syntactic' | 'authority';

export interface DecodedProtocolPayload {
  protocol_id: string;
  protocol_name: string;
  operation_type: string;
  parameters: Record<string, unknown>;
  confidence: number;
  decoding_level: DecodingLevel;
  status: 'decoded' | 'incomplete' | 'invalid';
  issues: string[];
}

export type { ProtocolActivityMetrics } from './protocol-activity';

export class ProtocolDecodeError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

/** Largest accepted input: 400 kB of script, far beyond any single output or tapscript. */
export const MAX_DECODE_HEX_CHARS = 800_000;

const CONFIDENCE: Record<DecodingLevel, number> = { marker: 0.3, syntactic: 0.85, authority: 1 };

function big(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

export class ProtocolRegistryService {
  private static instance: ProtocolRegistryService;
  private adapters: Map<string, ProtocolAdapterMetadata> = new Map();
  private observer: ProtocolActivityObserver | null = null;

  private constructor() {
    this.seedAdapters();
  }

  public static getInstance(): ProtocolRegistryService {
    if (!ProtocolRegistryService.instance) {
      ProtocolRegistryService.instance = new ProtocolRegistryService();
    }
    return ProtocolRegistryService.instance;
  }

  private seedAdapters(): void {
    const list: ProtocolAdapterMetadata[] = [
      {
        protocol_id: 'ordinals',
        name: 'Ordinals and Inscriptions',
        category: 'token',
        specification_url: 'https://docs.ordinals.com',
        version: '0.19.0',
        active: true,
        block_height_introduced: 767430,
        capabilities: { decode: true, metrics: true },
      },
      {
        protocol_id: 'runes',
        name: 'Runes Protocol',
        category: 'token',
        specification_url: 'https://docs.ordinals.com/runes.html',
        version: '0.1.0',
        active: true,
        block_height_introduced: 840000,
        capabilities: { decode: true, metrics: true },
      },
      {
        protocol_id: 'brc20',
        name: 'BRC-20 Token Standard',
        category: 'token',
        specification_url: 'https://domo-2.gitbook.io/brc-20-experiment/',
        version: '1.0.0',
        active: true,
        block_height_introduced: 779832,
        capabilities: { decode: true, metrics: true },
      },
      {
        protocol_id: 'lightning',
        name: 'Lightning Network Channels',
        category: 'layer2',
        specification_url: 'https://github.com/lightning/bolts',
        version: 'BOLT-1.0',
        active: true,
        block_height_introduced: 500000,
        capabilities: { decode: false, metrics: false },
      },
      {
        protocol_id: 'bip352_silent_payments',
        name: 'Silent Payments (BIP352)',
        category: 'privacy',
        specification_url: 'https://github.com/bitcoin/bips/blob/master/bip-0352.mediawiki',
        version: 'Draft',
        active: true,
        block_height_introduced: 830000,
        capabilities: { decode: false, metrics: false },
      },
      {
        protocol_id: 'opentimestamps',
        name: 'OpenTimestamps',
        category: 'metadata',
        specification_url: 'https://opentimestamps.org',
        version: '0.3.0',
        active: true,
        block_height_introduced: 400000,
        capabilities: { decode: true, metrics: false },
      },
    ];

    for (const a of list) {
      this.adapters.set(a.protocol_id, a);
    }
  }

  public getAdapters(): ProtocolAdapterMetadata[] {
    return Array.from(this.adapters.values());
  }

  public getAdapterById(id: string): ProtocolAdapterMetadata | null {
    return this.adapters.get(id) || null;
  }

  /** Called once at startup with the block observer that feeds getMetrics. */
  public attachObserver(observer: ProtocolActivityObserver): void {
    this.observer = observer;
  }

  /**
   * Decodes a scriptPubKey, a tapscript, or a detached OpenTimestamps proof
   * given as hex. Every returned field is derived from the bytes.
   */
  public decodePayload(rawHex: unknown): DecodedProtocolPayload[] {
    if (typeof rawHex !== 'string') {
      throw new ProtocolDecodeError('invalid_input', 'script_hex must be a string');
    }
    const trimmed = rawHex.trim();
    if (trimmed.length === 0) {
      throw new ProtocolDecodeError('invalid_input', 'script_hex is empty');
    }
    if (trimmed.length > MAX_DECODE_HEX_CHARS) {
      throw new ProtocolDecodeError('too_large', `script_hex exceeds ${MAX_DECODE_HEX_CHARS} hex characters`);
    }
    const bytes = hexToBuffer(trimmed);
    if (!bytes) {
      throw new ProtocolDecodeError('invalid_hex', 'script_hex must be even-length hexadecimal');
    }

    const results: DecodedProtocolPayload[] = [];

    if (bytes.length >= OTS_MAGIC.length && bytes.subarray(0, OTS_MAGIC.length).equals(OTS_MAGIC)) {
      results.push(this.decodeOtsProof(bytes));
      return results;
    }

    const runestone = decodeRunestone(bytes);
    if (runestone) {
      results.push(this.describeRunestone(runestone));
    }

    for (const envelope of parseInscriptionEnvelopes(bytes)) {
      results.push(this.describeInscription(envelope));
      const brc20 = envelope.incomplete ? null : parseBrc20(envelope);
      if (brc20) {
        results.push({
          protocol_id: 'brc20',
          protocol_name: 'BRC-20 Token Standard',
          operation_type: `brc20_${brc20.op}`,
          parameters: { ...brc20, inscription_index: envelope.index },
          confidence: CONFIDENCE.syntactic,
          decoding_level: 'syntactic',
          status: 'decoded',
          issues: [],
        });
      }
    }

    if (results.length === 0) {
      const generic = this.describeOpReturn(bytes);
      if (generic) { results.push(generic); }
    }

    return results;
  }

  private describeRunestone(runestone: Runestone): DecodedProtocolPayload {
    const cenotaph = runestone.flaws.length > 0;
    let operation = 'runestone';
    if (cenotaph) { operation = 'cenotaph'; }
    else if (runestone.etching) { operation = 'etching'; }
    else if (runestone.mint) { operation = 'mint'; }
    else if (runestone.edicts.length > 0) { operation = 'edict_transfer'; }
    const etching = runestone.etching;
    return {
      protocol_id: 'runes',
      protocol_name: 'Runes Protocol',
      operation_type: operation,
      parameters: {
        edicts: runestone.edicts.map(edict => ({
          rune_id: `${edict.id.block}:${edict.id.tx}`,
          amount: edict.amount.toString(),
          output_index: Number(edict.output),
        })),
        etching: etching ? {
          rune: etching.rune,
          divisibility: etching.divisibility,
          spacers: etching.spacers,
          symbol: etching.symbol,
          premine: big(etching.premine),
          turbo: etching.turbo,
          terms: etching.terms ? {
            amount: big(etching.terms.amount),
            cap: big(etching.terms.cap),
            height: [big(etching.terms.height[0]), big(etching.terms.height[1])],
            offset: [big(etching.terms.offset[0]), big(etching.terms.offset[1])],
          } : null,
        } : null,
        mint: runestone.mint ? `${runestone.mint.block}:${runestone.mint.tx}` : null,
        pointer: big(runestone.pointer),
        // Names of runes referenced by ID live in the runes index, not in the script.
        rune_names: 'not resolved: requires the runes authority',
        cenotaph_flaws: runestone.flaws,
      },
      confidence: cenotaph ? CONFIDENCE.marker : CONFIDENCE.syntactic,
      decoding_level: cenotaph ? 'marker' : 'syntactic',
      status: cenotaph ? 'invalid' : 'decoded',
      issues: runestone.flaws.map(flaw => `cenotaph: ${flaw}`),
    };
  }

  private describeInscription(envelope: InscriptionEnvelope): DecodedProtocolPayload {
    const issues: string[] = [];
    if (envelope.incomplete) { issues.push('envelope ends before OP_ENDIF'); }
    for (const flaw of envelope.flaws) { issues.push(`envelope: ${flaw}`); }
    const unbound = envelope.flaws.length > 0;
    return {
      protocol_id: 'ordinals',
      protocol_name: 'Ordinals and Inscriptions',
      operation_type: envelope.incomplete ? 'inscription_envelope_incomplete' : (unbound ? 'inscription_unbound' : 'inscription_reveal'),
      parameters: {
        envelope_index: envelope.index,
        content_type: envelope.contentType,
        content_encoding: envelope.contentEncoding,
        metaprotocol: envelope.metaprotocol,
        body_size_bytes: envelope.incomplete ? null : envelope.bodyBytes,
        body_bytes_seen: envelope.bodyBytes,
        pointer: big(envelope.pointer),
        parents: envelope.parents,
        delegate: envelope.delegate,
        metadata_bytes: envelope.metadataBytes,
        // The inscription ID and sat assignment come from the ordinals index.
        inscription_id: 'not resolved: requires the ordinals authority',
      },
      confidence: envelope.incomplete ? CONFIDENCE.marker : CONFIDENCE.syntactic,
      decoding_level: envelope.incomplete ? 'marker' : 'syntactic',
      status: envelope.incomplete ? 'incomplete' : (unbound ? 'invalid' : 'decoded'),
      issues,
    };
  }

  private decodeOtsProof(bytes: Buffer): DecodedProtocolPayload {
    try {
      const proof = parseDetachedProof(bytes.toString('base64'));
      const bitcoinHeights = proof.attestations.filter(a => a.kind === 'bitcoin').map(a => (a as { height: number }).height);
      const pendingCalendars = proof.attestations.filter(a => a.kind === 'pending').map(a => (a as { uri: string }).uri);
      return {
        protocol_id: 'opentimestamps',
        protocol_name: 'OpenTimestamps',
        operation_type: bitcoinHeights.length > 0 ? 'bitcoin_attestation' : 'pending_attestation',
        parameters: {
          digest_algorithm: proof.algorithm,
          digest: proof.digest.toString('hex'),
          bitcoin_block_heights: bitcoinHeights,
          pending_calendars: pendingCalendars,
          operations: proof.operationCount,
          // Whether the commitment is in those blocks is a chain check, not a decode.
          verification: 'not performed: use the timestamps verification endpoint',
        },
        confidence: CONFIDENCE.syntactic,
        decoding_level: 'syntactic',
        status: 'decoded',
        issues: [],
      };
    } catch (error) {
      return {
        protocol_id: 'opentimestamps',
        protocol_name: 'OpenTimestamps',
        operation_type: 'detached_proof_invalid',
        parameters: { reason: error instanceof Error ? error.message : String(error) },
        confidence: CONFIDENCE.marker,
        decoding_level: 'marker',
        status: 'invalid',
        issues: ['proof header recognised but the proof does not parse'],
      };
    }
  }

  private describeOpReturn(bytes: Buffer): DecodedProtocolPayload | null {
    const parsed = parseScript(bytes);
    if (parsed.instructions.length === 0 || parsed.instructions[0].opcode !== OP_RETURN) {
      return null;
    }
    const pushes = parsed.instructions.slice(1).filter(isPush).map(instruction => instruction.data);
    const data = Buffer.concat(pushes);
    const issues: string[] = [];
    if (parsed.error) { issues.push(`script: ${parsed.error.reason} at byte ${parsed.error.offset}`); }
    return {
      protocol_id: 'generic_op_return',
      protocol_name: 'Generic Data Carrier',
      operation_type: 'data_carrier',
      parameters: {
        push_count: pushes.length,
        push_sizes: pushes.map(push => push.length),
        data_hex: data.toString('hex'),
        length: data.length,
      },
      confidence: parsed.error ? CONFIDENCE.marker : CONFIDENCE.syntactic,
      decoding_level: parsed.error ? 'marker' : 'syntactic',
      status: parsed.error ? 'incomplete' : 'decoded',
      issues,
    };
  }

  /**
   * Activity for a registered protocol from blocks this backend has
   * processed: { metrics } when measured, { unavailable } with the reason
   * when the protocol is registered but not observable here, null for an
   * unknown protocol ID.
   */
  public getMetrics(protocolId: string): { metrics: ProtocolActivityMetrics } | { unavailable: string } | null {
    if (!this.adapters.has(protocolId)) {
      return null;
    }
    if (!this.observer || !this.observer.isObserved(protocolId)) {
      return { unavailable: `${protocolId} activity is not identifiable from block scripts alone; it needs its own authority` };
    }
    const metrics = this.observer.getMetrics(protocolId);
    if (!metrics) {
      return { unavailable: 'no block has been observed by this backend yet' };
    }
    return { metrics };
  }
}

export const protocolRegistryService = ProtocolRegistryService.getInstance();
