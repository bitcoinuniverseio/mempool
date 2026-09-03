import {
  WildkinBraidCeremony,
  WildkinCreature,
  WildkinStatusSummary,
} from './wildkin.types';

const CREATURES: WildkinCreature[] = [
  {
    creatureId: 'wk-cr-001',
    inscriptionId: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0fi0',
    inscriptionNumber: 7891024,
    name: 'Wildkin Timber Alpha',
    generation: 0,
    bindingUtxo: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f:0',
    ownerAddress: 'bc1p5d7rjq7g6rd2ee0005uv896248xy9c35360da65cb5134267e67sqvjcv3',
    genomeHex: 'a262776b00617600',
    formatTag: 'wk',
    rulesetVersion: 0,
    hasBraided: true,
    status: 'braided',
    birthBlockHeight: 841200,
    birthTimestamp: 1713800000,
  },
  {
    creatureId: 'wk-cr-002',
    inscriptionId: 'b198374291847eabcf9817294817294817294817294817294817294817294817i0',
    inscriptionNumber: 7891025,
    name: 'Wildkin Ember Sylph',
    generation: 0,
    bindingUtxo: 'b198374291847eabcf9817294817294817294817294817294817294817294817:0',
    ownerAddress: 'bc1p9u2n759vj6s544f8pwy60y4e844t5q890cdse444n894v69n0q2sxve80q',
    genomeHex: 'a262776b00617600',
    formatTag: 'wk',
    rulesetVersion: 0,
    hasBraided: true,
    status: 'braided',
    birthBlockHeight: 841205,
    birthTimestamp: 1713800300,
  },
  {
    creatureId: 'wk-cr-003',
    inscriptionId: 'a8b19e288924b17f9e855651c6b12f60a92d477839cf9e1d82136e0018d9bc34i0',
    inscriptionNumber: 7924010,
    name: 'Wildkin Forest Sentinel',
    generation: 1,
    bindingUtxo: 'a8b19e288924b17f9e855651c6b12f60a92d477839cf9e1d82136e0018d9bc34:0',
    ownerAddress: 'bc1p5d7rjq7g6rd2ee0005uv896248xy9c35360da65cb5134267e67sqvjcv3',
    parentAId: 'wk-cr-001',
    parentBId: 'wk-cr-002',
    genomeHex: 'a262776b00617600a16667656e6f6d65',
    formatTag: 'wk',
    rulesetVersion: 0,
    hasBraided: false,
    status: 'active',
    birthBlockHeight: 845000,
    birthTimestamp: 1714100000,
  },
];

const BRAIDS: WildkinBraidCeremony[] = [
  {
    braidTxid: 'a8b19e288924b17f9e855651c6b12f60a92d477839cf9e1d82136e0018d9bc34',
    heirCreatureId: 'wk-cr-003',
    parentAId: 'wk-cr-001',
    parentBId: 'wk-cr-002',
    inheritanceManifestHash: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    relationshipAttestationHash: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
    blockHeight: 845000,
    timestamp: 1714100000,
    confirmations: 15142,
    valid: true,
  },
];

export class WildkinService {
  /** @asyncSafe */
  public async $getStatus(): Promise<WildkinStatusSummary> {
    return {
      ruleset: 'Wildkin ruleset v0',
      activationStatus: 'draft',
      totalCreaturesCount: CREATURES.length,
      totalBraidsCount: BRAIDS.length,
      maxAncestryDepth: 1,
      latestCreatures: CREATURES,
    };
  }

  /** @asyncSafe */

  public async $getCreatures(): Promise<WildkinCreature[]> {
    return CREATURES;
  }

  /** @asyncSafe */

  public async $getCreature(id: string): Promise<WildkinCreature | null> {
    const match = CREATURES.find(
      (c) => c.creatureId.toLowerCase() === id.toLowerCase() || c.inscriptionId.toLowerCase() === id.toLowerCase()
    );
    return match || null;
  }

  /** @asyncSafe */

  public async $getBraids(): Promise<WildkinBraidCeremony[]> {
    return BRAIDS;
  }
}

export const wildkinService = new WildkinService();
