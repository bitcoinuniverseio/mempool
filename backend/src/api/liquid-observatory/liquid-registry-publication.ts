import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { isAbsolute } from 'path';
import { LiquidObservatoryEvidenceError as EvidenceError } from './liquid-evidence-error';
import { LiquidProjectionSnapshot } from './liquid-projection-engine';

export interface LiquidRegistryEntry {
  assetId: string; name: string; ticker: string; precision: number;
  issuanceTxid: string; issuanceVin: number; assetEntropy: string;
  reissuanceToken: string | null; provenance: string;
}
export interface LiquidRegistryPublication {
  publicationRevision: string; scope: string; sha256: string; assets: LiquidRegistryEntry[];
}
const HASH = /^[0-9a-f]{64}$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
  && [...value].every(character => character.charCodeAt(0) >= 32);
const invalid = (): never => { throw new EvidenceError('invalid-asset-registry', 'The operator-published catalog does not match the selected canonical issuance evidence.'); };

/** Display names are explicit publication assertions, not chain-derived issuer identities. */
export class LiquidRegistryReader {
  constructor(private readonly file: string | undefined = process.env.UNIVERSE_LIQUID_REGISTRY_PUBLICATION_FILE) {}
  /** @asyncUnsafe */
  async read(snapshot: LiquidProjectionSnapshot, signal: AbortSignal): Promise<LiquidRegistryPublication> {
    if (!this.file) throw new EvidenceError('unavailable-asset-registry', 'The operator-published Liquid catalog is not configured.');
    try {
      if (signal.aborted) throw new EvidenceError('liquid-source-deadline', 'The catalog read was cancelled.', 504);
      if (!isAbsolute(this.file)) return invalid();
      const metadata = await fs.stat(this.file);
      if (!metadata.isFile() || metadata.size > 1024 * 1024) return invalid();
      const bytes = await fs.readFile(this.file);
      if (bytes.length > 1024 * 1024) return invalid();
      const raw = JSON.parse(bytes.toString('utf8'));
      if (signal.aborted) throw new EvidenceError('liquid-source-deadline', 'The catalog read was cancelled.', 504);
      if (raw?.schema !== 'universe-liquid-registry-publication-v1' || !text(raw.publicationRevision, 128)
        || !text(raw.scope, 1024) || raw.network !== snapshot.observation.profile.network
        || raw.genesisHash !== snapshot.observation.elements.genesis || !Array.isArray(raw.assets) || raw.assets.length > 1000) return invalid();
      const ids = new Set<string>();
      const assets: LiquidRegistryEntry[] = [];
      for (const entry of raw.assets) {
        if (typeof entry?.assetId !== 'string' || !HASH.test(entry.assetId) || ids.has(entry.assetId)
          || !text(entry.name, 128) || !text(entry.ticker, 32) || !text(entry.provenance, 1024)
          || !Number.isSafeInteger(entry.precision) || entry.precision < 0 || entry.precision > 8
          || typeof entry.issuanceTxid !== 'string' || !HASH.test(entry.issuanceTxid)
          || !Number.isSafeInteger(entry.issuanceVin) || entry.issuanceVin < 0 || !HASH.test(entry.assetEntropy)
          || entry.reissuanceToken !== null && !HASH.test(entry.reissuanceToken)) return invalid();
        const issuance = snapshot.state.blocks.flatMap(block => block.issuances).find(value => !value.isReissuance
          && value.asset === entry.assetId && value.txid === entry.issuanceTxid && value.vin === entry.issuanceVin);
        if (!issuance) {
          if (snapshot.status === 'PARTIAL') throw new EvidenceError('incomplete-asset-registry-proof', 'Continue the public block projection before publishing this catalog entry.', 409);
          return invalid();
        }
        if (issuance.entropy !== entry.assetEntropy || issuance.token !== entry.reissuanceToken) return invalid();
        ids.add(entry.assetId);
        assets.push({ assetId: entry.assetId, name: entry.name, ticker: entry.ticker, precision: entry.precision,
          issuanceTxid: entry.issuanceTxid, issuanceVin: entry.issuanceVin, assetEntropy: entry.assetEntropy,
          reissuanceToken: entry.reissuanceToken, provenance: entry.provenance });
      }
      assets.sort((a, b) => a.assetId.localeCompare(b.assetId));
      return { publicationRevision: raw.publicationRevision, scope: raw.scope,
        sha256: createHash('sha256').update(bytes).digest('hex'), assets };
    } catch (error) {
      if (error instanceof EvidenceError) throw error;
      throw new EvidenceError('unavailable-asset-registry', 'The configured operator-published Liquid catalog could not be read.');
    }
  }
}
