import { decodeRunestone, Runestone } from './runestone';
import {
  Brc20Observation, formatInscriptionId, InscriptionEnvelope, observeBrc20, observedCurseConditions, ORD_REFERENCE,
  parseInscriptionEnvelopes, parseTransactionEnvelopes,
} from './inscription-envelope';
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
/*
 * Every observation is returned: one Ordinals result per envelope (complete or not) plus a BRC-20 result
 * whenever the body carries the marker, so one inscription keeps all its classifications. Rules follow
 * ord 0.29.0 (7e37a3bd) and OPI 7933f5d0; nothing is promoted to a holding or accepted operation. Other
 * inscription protocols (names, bitmap, tap, dmt, unat, dust20, block20) need their own authorities.
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
      results.push(...this.describeEnvelope(envelope, null));
    }

    if (results.length === 0) {
      const generic = this.describeOpReturn(bytes);
      if (generic) { results.push(generic); }
    }

    return results;
  }

  /**
   * Decodes the inscription envelopes of a whole transaction from its input
   * witnesses (hex stack items, one array per input, in input order), so each
   * ord-recognized envelope gets its transaction-wide index and candidate ID.
   */
  public decodeTransactionInscriptions(txid: unknown, witnesses: unknown): DecodedProtocolPayload[] {
    if (typeof txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(txid)) {
      throw new ProtocolDecodeError('invalid_input', 'txid must be 64 hexadecimal characters');
    }
    if (!Array.isArray(witnesses) || witnesses.some(witness => !Array.isArray(witness))) {
      throw new ProtocolDecodeError('invalid_input', 'witnesses must be an array of hex stack arrays, one per input');
    }
    let total = 0;
    const stacks = (witnesses as unknown[][]).map(witness => witness.map(item => {
      const buffer = typeof item === 'string' ? (item === '' ? Buffer.alloc(0) : hexToBuffer(item)) : null;
      if (!buffer) {
        throw new ProtocolDecodeError('invalid_hex', 'witness items must be even-length hexadecimal');
      }
      total += buffer.length * 2;
      if (total > MAX_DECODE_HEX_CHARS) {
        throw new ProtocolDecodeError('too_large', `witnesses exceed ${MAX_DECODE_HEX_CHARS} hex characters`);
      }
      return buffer;
    }));
    const results: DecodedProtocolPayload[] = [];
    for (const envelope of parseTransactionEnvelopes(stacks)) {
      results.push(...this.describeEnvelope(envelope, txid.toLowerCase()));
    }
    return results;
  }

  private describeEnvelope(envelope: InscriptionEnvelope, txid: string | null): DecodedProtocolPayload[] {
    const brc20 = envelope.ordRecognized ? observeBrc20(envelope) : null;
    const results = [this.describeInscription(envelope, txid, brc20)];
    if (brc20) { results.push(this.describeBrc20(envelope, brc20)); }
    return results;
  }

  private describeBrc20(envelope: InscriptionEnvelope, brc20: Brc20Observation): DecodedProtocolPayload {
    const known = brc20.op === 'deploy' || brc20.op === 'mint' || brc20.op === 'transfer';
    let operation = 'brc20_not_inspected';
    if (brc20.syntax === 'valid') { operation = `brc20_${brc20.op}`; }
    else if (brc20.syntax === 'invalid') { operation = known ? `brc20_${brc20.op}_invalid` : 'brc20_marker_invalid'; }
    const parameters: Record<string, unknown> = {
      ...brc20,
      inscription_index: envelope.index,
      input_index: envelope.input,
      transaction_inscription_index: envelope.inscriptionIndex,
      balance_effect: 'none: an observation is not an accepted operation',
    };
    for (const key of ['amt', 'max', 'lim', 'dec', 'self_mint'] as const) {
      if (brc20[key] === null) { delete parameters[key]; }
    }
    return {
      protocol_id: 'brc20',
      protocol_name: 'BRC-20 Token Standard',
      operation_type: operation,
      parameters,
      confidence: brc20.syntax === 'valid' ? CONFIDENCE.syntactic : (brc20.syntax === 'invalid' ? CONFIDENCE.marker : 0),
      decoding_level: brc20.syntax === 'valid' ? 'syntactic' : 'marker',
      status: brc20.syntax === 'valid' ? 'decoded' : (brc20.syntax === 'invalid' ? 'invalid' : 'incomplete'),
      issues: brc20.issues,
    };
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

/*
 * Parser flags are observations, not verdicts: in ord 0.29.0 (7e37a3bd) inscription_updater.rs the curse
 * outcome depends on the Jubilee height and reinscription state, and unbound also on a zero-value input.
 * A recognized envelope is therefore decoded with its curse conditions and every classification it
 * carries, while location, curse state, binding and parent provenance stay authority-required.
 */
  private describeInscription(envelope: InscriptionEnvelope, txid: string | null, brc20: Brc20Observation | null): DecodedProtocolPayload {
    const issues: string[] = [];
    if (envelope.incomplete) { issues.push(`envelope not recognized by ord: ${envelope.incompleteReason}`); }
    for (const flaw of envelope.flaws) { issues.push(`envelope: ${flaw}`); }
    const classifications: string[] = [];
    if (envelope.ordRecognized) {
      classifications.push('ordinals:inscription');
      if (envelope.parentValues.length > 0) { classifications.push('ordinals:child_claim'); }
      if (envelope.delegateHex !== null) { classifications.push('ordinals:delegate_claim'); }
      if (envelope.runeField) { classifications.push('ordinals:rune_commitment'); }
      if (envelope.metaprotocol !== null) { classifications.push(`metaprotocol:${envelope.metaprotocol}`); }
      if (brc20) { classifications.push(brc20.syntax === 'valid' ? `brc20:${brc20.op}` : `brc20:marker_${brc20.syntax}`); }
    }
    // txid plus the transaction-wide envelope index gives the candidate ID; whether ord indexed it is the authority's call.
    const inscriptionId = txid !== null && envelope.inscriptionIndex !== null
      ? formatInscriptionId(txid, envelope.inscriptionIndex)
      : 'not resolved: requires the ordinals authority';
    return {
      protocol_id: 'ordinals',
      protocol_name: 'Ordinals and Inscriptions',
      operation_type: envelope.incomplete ? 'inscription_envelope_incomplete' : 'inscription_reveal',
      parameters: {
        reference: ORD_REFERENCE,
        envelope_index: envelope.index,
        input_index: envelope.input,
        envelope_offset: envelope.offset,
        transaction_inscription_index: envelope.inscriptionIndex,
        ord_recognized: envelope.ordRecognized,
        content_type: envelope.contentType,
        content_type_hex: envelope.contentTypeHex,
        content_encoding: envelope.contentEncoding,
        metaprotocol: envelope.metaprotocol,
        body_present: envelope.hasBody,
        body_size_bytes: envelope.incomplete ? null : envelope.bodyBytes,
        body_bytes_seen: envelope.bodyBytes,
        pointer: big(envelope.pointer),
        pointer_hex: envelope.pointerHex,
        parents: envelope.parents,
        parent_values_hex: envelope.parentValues,
        delegate: envelope.delegate,
        delegate_hex: envelope.delegateHex,
        rune_hex: envelope.runeHex,
        metadata_bytes: envelope.metadataBytes,
        properties_hex: envelope.properties ? envelope.properties.toString('hex') : null,
        property_encoding_hex: envelope.propertyEncoding,
        unknown_fields: envelope.unknownFields,
        repeated_fields: envelope.repeatedFields,
        flags: envelope.flags,
        curse_conditions: observedCurseConditions(envelope),
        classifications,
        inscription_id: inscriptionId,
        authority_required: {
          indexed: 'authority-required',
          location: 'authority-required',
          curse_state: 'authority-required: depends on the network Jubilee height and reinscription state',
          binding: envelope.flags.unrecognized_even_field
            ? 'unbound per ord: unrecognized even field'
            : 'authority-required: also unbound when the input value is zero',
          parent_provenance: envelope.parentValues.length > 0 ? 'authority-required: the parent must be spent in the reveal' : null,
          input_position: envelope.input === null ? 'authority-required: a bare script has no input index' : null,
        },
      },
      confidence: envelope.incomplete ? CONFIDENCE.marker : CONFIDENCE.syntactic,
      decoding_level: envelope.incomplete ? 'marker' : 'syntactic',
      status: envelope.incomplete ? 'incomplete' : 'decoded',
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
