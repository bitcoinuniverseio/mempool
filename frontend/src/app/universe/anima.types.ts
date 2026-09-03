/**
 * Documents served by the ANIMA evidence reader at /api/v1/anima/*.
 *
 * Every field is what index-anima, the first-party authority, states. A
 * field the authority does not carry is absent here too: nothing is
 * defaulted into looking known.
 */

export type AnimaDocumentState = 'served' | 'unconfigured' | 'unavailable';

export interface AnimaSupply {
  created: number;
  live: number;
  fused: number;
  spawned: number;
  retired: number;
  burned: number;
}

export interface AnimaStatusDocument {
  schemaVersion: 'universe-anima-v1';
  authorityId: 'index-anima';
  state: AnimaDocumentState;
  status: {
    network: string;
    activationHeight: number;
    kindling: { start: number; end: number };
    scanner: {
      tipHeight: number | null;
      tipHash: string | null;
      nodeHeight: number | null;
      reorgs: number;
      blocksApplied: number;
      syncing: boolean;
      lastError: string | null;
    };
    supply: AnimaSupply;
  };
  loggedEventCountAtomic: string | null;
  degradedReason: string | null;
}

export interface AnimaLoggedEvent {
  eventId: string;
  height: number;
  txIndex: number;
  txid: string;
  kind: string;
  organisms: string[];
}

export interface AnimaEventsDocument {
  schemaVersion: 'universe-anima-v1';
  authorityId: 'index-anima';
  state: AnimaDocumentState;
  total: number;
  from: number;
  events: AnimaLoggedEvent[];
  degradedReason: string | null;
}

export interface AnimaEventDocument {
  schemaVersion: 'universe-anima-v1';
  authorityId: 'index-anima';
  state: AnimaDocumentState;
  event: AnimaLoggedEvent;
  degradedReason: string | null;
}

export interface AnimaWaymark {
  seq: number;
  height: number;
  txid: string;
  mem: Record<string, string> | null;
  man: string | null;
  model: string | null;
  note: string | null;
}

export interface AnimaAchievement {
  claim: string;
  attClass: number;
  subject: string;
  participants: string[];
  height: number;
  txid: string;
}

export interface AnimaOrganism {
  id: string;
  genesisTxid: string;
  genesisVout: number;
  genome: string;
  spec: string;
  meta: string | null;
  vessel: {
    txid: string;
    vout: number;
    scriptPubKey: string;
    value: number;
  } | null;
  status: string;
  createdHeight: number;
  generationZero: boolean;
  origin: string;
  parents: string[];
  children: string[];
  waymarkSeq: number;
  waymarks: AnimaWaymark[];
  achievements: AnimaAchievement[];
  transferCount: number;
  endedHeight: number | null;
  endedTxid: string | null;
}

export interface AnimaOrganismsDocument {
  schemaVersion: 'universe-anima-v1';
  authorityId: 'index-anima';
  state: AnimaDocumentState;
  total: number;
  offset: number;
  limit: number;
  organisms: AnimaOrganism[];
  degradedReason: string | null;
}

export interface AnimaOrganismDocument {
  schemaVersion: 'universe-anima-v1';
  authorityId: 'index-anima';
  state: AnimaDocumentState;
  organism: AnimaOrganism;
  degradedReason: string | null;
}

export interface AnimaOrganismHistoryDocument {
  schemaVersion: 'universe-anima-v1';
  authorityId: 'index-anima';
  state: AnimaDocumentState;
  organism: AnimaOrganism;
  lineage: {
    id: string;
    parents: string[];
    children: string[];
    ancestors: string[];
    descendants: string[];
  } | null;
  degradedReason: string | null;
}
