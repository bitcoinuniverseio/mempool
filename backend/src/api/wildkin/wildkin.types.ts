/**
 * Types for Wildkin Inscription-based Creature and Bloodline Evidence Explorer.
 */

export interface WildkinCreature {
  readonly creatureId: string;
  readonly inscriptionId: string;
  readonly inscriptionNumber: number;
  readonly name: string;
  readonly generation: number;
  readonly bindingUtxo: string;
  readonly ownerAddress: string;
  readonly parentAId?: string;
  readonly parentBId?: string;
  readonly genomeHex: string;
  readonly formatTag: 'wk';
  readonly rulesetVersion: number;
  readonly hasBraided: boolean;
  readonly status: 'active' | 'transferred' | 'braided';
  readonly birthBlockHeight: number;
  readonly birthTimestamp: number;
}

export interface WildkinBraidCeremony {
  readonly braidTxid: string;
  readonly heirCreatureId: string;
  readonly parentAId: string;
  readonly parentBId: string;
  readonly inheritanceManifestHash: string;
  readonly relationshipAttestationHash: string;
  readonly blockHeight: number;
  readonly timestamp: number;
  readonly confirmations: number;
  readonly valid: boolean;
}

export interface WildkinStatusSummary {
  readonly ruleset: string;
  readonly activationStatus: 'draft' | 'active';
  readonly totalCreaturesCount: number;
  readonly totalBraidsCount: number;
  readonly maxAncestryDepth: number;
  readonly latestCreatures: readonly WildkinCreature[];
}
