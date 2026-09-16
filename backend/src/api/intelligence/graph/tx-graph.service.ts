import * as crypto from 'crypto';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import { IEsploraApi } from '../../bitcoin/esplora-api.interface';
import config from '../../../config';
import { EventEnvelopeValidator } from '../events/event-envelope';
import { AuthenticatedOwner, IdentityError } from '../identity/developer-identity';
import { GraphCaseRow, ownerStore } from '../identity/owner-store';

/**
 * Multi-hop transaction graph over the owned index.
 *
 * The revision this replaces invented every neighbour: parents were named
 * "<root>-p1" and carried 3,000,000 sats, and the shortest path always
 * existed. Now a node is a transaction or address this deployment's Esplora
 * index actually returned, an edge is an input or an output it actually
 * has, and the walk is bounded by hops, by node count and by a fetch budget
 * so one query cannot drain the index.
 */

export interface GraphNode {
  id: string;
  type: 'transaction' | 'outpoint' | 'address';
  label: string;
  value_sats: number | null;
  status: 'confirmed' | 'mempool' | 'replaced' | 'conflicted' | 'unknown';
  block_height?: number;
  depth: number;
  evidence_tags?: string[];
}

export interface GraphEdge {
  source_id: string;
  target_id: string;
  value_sats: number;
  vout: number;
  spending_txid?: string;
  edge_type: 'input' | 'output' | 'replacement';
}

export interface GraphQueryResult {
  query_id: string;
  root_entity: string;
  root_type: 'transaction' | 'address';
  network: string;
  hops: number;
  direction: 'upstream' | 'downstream' | 'both';
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  /** Why the walk stopped early, when it did. */
  truncation_reason: 'node_limit' | 'fetch_budget' | 'address_page' | null;
  total_nodes_count: number;
  fetches: number;
  generated_at: string;
}

export interface ShortestPathResult {
  network: string;
  from_entity: string;
  to_entity: string;
  path_found: boolean;
  total_hops: number;
  total_value_transferred_sats: null;
  value_upper_bound_sats: number | null;
  transfer_scope: string;
  node_sequence: string[];
  edge_sequence: GraphEdge[];
  /** True when the search hit its budget before exhausting the reachable set. */
  search_exhausted: boolean;
  fetches: number;
}

export interface SavedGraphCase {
  case_id: string;
  owner_id: string;
  title: string;
  root_entity: string;
  hops: number;
  nodes_count: number;
  filters: Record<string, unknown>;
  layout: Record<string, unknown>;
  notes: string;
  is_shared: boolean;
  share_token?: string;
  created_at: string;
  updated_at: string;
}

export class GraphInputError extends Error {
  constructor(message: string) { super(message); }
}

export class GraphIndexError extends Error {
  constructor(public readonly status: 404 | 503, message: string) { super(message); }
}

async function readIndex<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    const failure = error as { response?: { status?: number; data?: unknown }; code?: number };
    if (failure?.response?.status === 404 && failure.response.data === 'Transaction not found') {
      throw new GraphIndexError(404, 'The requested record is not in the selected index.');
    }
    throw new GraphIndexError(503, 'The selected transaction index could not complete the graph read.');
  }
}

function checkedTransaction(tx: IEsploraApi.Transaction, expected?: string): IEsploraApi.Transaction {
  if (!tx || typeof tx.txid !== 'string' || !TXID.test(tx.txid) || expected !== undefined && tx.txid !== expected || !Array.isArray(tx.vin) || !Array.isArray(tx.vout) || tx.vout.some(output => !output || !Number.isSafeInteger(output.value) || output.value < 0 || output.value > 2100000000000000) || !Number.isSafeInteger(tx.vout.reduce((sum, output) => sum + output.value, 0))) throw new GraphIndexError(503, 'The index returned incomplete or invalid transaction evidence.');
  return tx;
}

function checkedOutspends(tx: IEsploraApi.Transaction, outspends: IEsploraApi.Outspend[]): IEsploraApi.Outspend[] {
  if (!Array.isArray(outspends) || outspends.length !== tx.vout.length ||
      outspends.some(spend => typeof spend?.spent !== 'boolean' || (spend.spent && (typeof spend.txid !== 'string' || !TXID.test(spend.txid))))) {
    throw new GraphIndexError(503, 'The index returned an incomplete outspend document.');
  }
  return outspends;
}

export const GRAPH_LIMITS = { maxHops: 4, maxNodes: 200, fetchBudget: 120, addressPageSize: 25, caseTitle: 128, caseNotes: 4096, casesPerOwner: 200 } as const;

const TXID = /^[0-9a-fA-F]{64}$/;

/** A minimal Esplora surface, so tests can supply a fixture index. */
export interface GraphIndex {
  transaction(txid: string): Promise<IEsploraApi.Transaction>;
  outspends(txid: string): Promise<IEsploraApi.Outspend[]>;
  addressTransactions(address: string): Promise<IEsploraApi.Transaction[]>;
}

const esploraIndex: GraphIndex = {
  transaction: txid => bitcoinApi.$getRawTransaction(txid),
  outspends: txid => bitcoinApi.$getOutspends(txid),
  addressTransactions: address => bitcoinApi.$getAddressTransactions(address, ''),
};

class Budget {
  public used = 0;
  constructor(private readonly limit: number) {}
  public take(): boolean { if (this.used >= this.limit) { return false; } this.used++; return true; }
  public exhausted(): boolean { return this.used >= this.limit; }
}

export class TxGraphService {
  private static instance: TxGraphService;
  public index: GraphIndex = esploraIndex;

  private constructor() {}

  public static getInstance(): TxGraphService {
    if (!TxGraphService.instance) {
      TxGraphService.instance = new TxGraphService();
    }
    return TxGraphService.instance;
  }

  private static classify(entity: string): 'transaction' | 'address' {
    if (TXID.test(entity)) { return 'transaction'; }
    if (/^[a-zA-Z0-9]{14,120}$/.test(entity)) { return 'address'; }
    throw new GraphInputError('root_entity must be a txid or an address');
  }

  private static txNode(tx: IEsploraApi.Transaction, depth: number): GraphNode {
    return {
      id: tx.txid, type: 'transaction', label: tx.txid.slice(0, 10),
      value_sats: tx.vout.reduce((sum, vout) => sum + (vout.value ?? 0), 0),
      status: tx.status?.confirmed === true ? 'confirmed' : tx.status?.confirmed === false ? 'mempool' : 'unknown',
      block_height: tx.status?.confirmed ? tx.status.block_height : undefined,
      depth, evidence_tags: [],
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async queryGraph(rootEntity: string, hops = 2, direction: 'upstream' | 'downstream' | 'both' = 'both', minValueSats = 0): Promise<GraphQueryResult> {
    const suppliedRoot = String(rootEntity ?? '').trim();
    const root = TXID.test(suppliedRoot) ? suppliedRoot.toLowerCase() : suppliedRoot;
    const rootType = TxGraphService.classify(root);
    if (!['upstream', 'downstream', 'both'].includes(direction)) { throw new GraphInputError('direction must be upstream, downstream or both'); }
    if (!Number.isSafeInteger(hops) || hops < 1) throw new GraphInputError('hops must be a positive integer');
    if (!Number.isSafeInteger(minValueSats) || minValueSats < 0) throw new GraphInputError('min_value_sats must be a nonnegative safe integer');
    const boundedHops = Math.min(Math.max(1, Math.floor(hops) || 1), GRAPH_LIMITS.maxHops);
    const minValue = Number.isFinite(minValueSats) && minValueSats > 0 ? Math.floor(minValueSats) : 0;
    const budget = new Budget(GRAPH_LIMITS.fetchBudget);
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const edgeKeys = new Set<string>();
    let truncation: GraphQueryResult['truncation_reason'] = null;

    const addEdge = (edge: GraphEdge): void => {
      const key = `${edge.source_id}>${edge.target_id}:${edge.vout}:${edge.edge_type}`;
      if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push(edge); }
    };
    const room = (): boolean => { if (nodes.size >= GRAPH_LIMITS.maxNodes) { truncation = truncation ?? 'node_limit'; return false; } return true; };
    const cache = new Map<string, IEsploraApi.Transaction>();
    /** @asyncUnsafe rejections propagate to the caller, which handles them. */
    const fetchTx = async (txid: string): Promise<IEsploraApi.Transaction | null> => {
      const cached = cache.get(txid);
      if (cached) { return cached; }
      if (!budget.take()) { truncation = truncation ?? 'fetch_budget'; return null; }
      const tx = await readIndex(() => this.index.transaction(txid));
      checkedTransaction(tx, txid);
      cache.set(txid, tx);
      return tx;
    };

    const frontier: { txid: string; depth: number }[] = [];
    if (rootType === 'transaction') {
      const tx = await fetchTx(root);
      if (!tx) { throw new GraphInputError(`transaction ${root} is not in this index`); }
      nodes.set(tx.txid, TxGraphService.txNode(tx, 0));
      frontier.push({ txid: tx.txid, depth: 0 });
    } else {
      if (!budget.take()) { throw new GraphInputError('fetch budget exhausted'); }
      let txs: IEsploraApi.Transaction[];
      txs = await readIndex(() => this.index.addressTransactions(root));
      if (!Array.isArray(txs) || txs.length > 10000) throw new GraphIndexError(503, 'Invalid address transaction page.');
      if (txs.length >= GRAPH_LIMITS.addressPageSize) truncation = 'address_page';
      nodes.set(root, { id: root, type: 'address', label: root.slice(0, 10), value_sats: null, status: 'unknown', depth: 0, evidence_tags: [] });
      for (const tx of txs.slice(0, GRAPH_LIMITS.addressPageSize)) {
        checkedTransaction(tx);
        if (!room()) break;
        const links: GraphEdge[] = [];
        if (direction !== 'downstream') tx.vout.forEach((vout, index) => { if (vout.scriptpubkey_address === root && vout.value >= minValue) links.push({ source_id: tx.txid, target_id: root, value_sats: vout.value, vout: index, edge_type: 'output' }); });
        if (direction !== 'upstream') for (const vin of tx.vin) {
          if (vin.is_coinbase || !vin.txid) continue;
          const parent = await fetchTx(vin.txid); if (!parent) break;
          const output = parent.vout[vin.vout];
          if (!Number.isInteger(vin.vout) || vin.vout < 0 || !output) throw new GraphIndexError(503, 'Input refers to an absent parent output.');
          if (output.scriptpubkey_address === root && output.value >= minValue) links.push({ source_id: root, target_id: tx.txid, value_sats: output.value, vout: vin.vout, spending_txid: tx.txid, edge_type: 'input' });
        }
        if (!links.length) continue;
        cache.set(tx.txid, tx); nodes.set(tx.txid, TxGraphService.txNode(tx, 1));
        links.forEach(addEdge); frontier.push({ txid: tx.txid, depth: 1 });
      }
    }

    const visited = new Set<string>();
    while (frontier.length > 0) {
      const current = frontier.shift() as { txid: string; depth: number };
      if (visited.has(current.txid) || current.depth >= boundedHops) { continue; }
      visited.add(current.txid);
      const tx = await fetchTx(current.txid);
      if (!tx) { continue; }
      if (direction !== 'downstream') {
        for (const vin of tx.vin) {
          if (vin.is_coinbase || !vin.txid) { continue; }
          const parent = await fetchTx(vin.txid);
          if (!parent) break;
          const output = parent.vout[vin.vout];
          if (!Number.isInteger(vin.vout) || vin.vout < 0 || !output) throw new GraphIndexError(503, 'Input refers to an absent parent output.');
          const value = output.value;
          if (value < minValue) { continue; }
          if (!nodes.has(vin.txid)) {
            if (!room()) { break; }
            nodes.set(parent.txid, TxGraphService.txNode(parent, current.depth + 1));
            frontier.push({ txid: parent.txid, depth: current.depth + 1 });
          }
          addEdge({ source_id: vin.txid, target_id: tx.txid, value_sats: value, vout: vin.vout, spending_txid: tx.txid, edge_type: 'input' });
        }
      }
      if (direction !== 'upstream') {
        if (!budget.take()) { truncation = truncation ?? 'fetch_budget'; break; }
        let outspends: IEsploraApi.Outspend[] = [];
        outspends = checkedOutspends(tx, await readIndex(() => this.index.outspends(tx.txid)));
        for (let index = 0; index < outspends.length; index++) {
          const spend = outspends[index];
          const value = tx.vout[index]?.value ?? 0;
          if (!spend?.spent || !spend.txid || value < minValue) { continue; }
          if (!nodes.has(spend.txid)) {
            if (!room()) { break; }
            const child = await fetchTx(spend.txid);
            if (!child) { break; }
            nodes.set(child.txid, TxGraphService.txNode(child, current.depth + 1));
            frontier.push({ txid: child.txid, depth: current.depth + 1 });
          }
          addEdge({ source_id: tx.txid, target_id: spend.txid, value_sats: value, vout: index, spending_txid: spend.txid, edge_type: 'output' });
        }
      }
    }

    const nodeList = [...nodes.values()];
    return {
      query_id: EventEnvelopeValidator.generateUuidV7(), root_entity: root, root_type: rootType, network: config.MEMPOOL.NETWORK, hops: boundedHops, direction,
      nodes: nodeList, edges, truncated: truncation !== null, truncation_reason: truncation, total_nodes_count: nodeList.length, fetches: budget.used,
      generated_at: new Date().toISOString(),
    };
  }

  /** @asyncUnsafe Breadth-first downstream search from one transaction to another, within the hop and fetch limits. */
  public async findShortestPath(fromEntity: string, toEntity: string): Promise<ShortestPathResult> {
    const from = String(fromEntity ?? '').trim().toLowerCase();
    const to = String(toEntity ?? '').trim().toLowerCase();
    if (!TXID.test(from) || !TXID.test(to)) { throw new GraphInputError('from_entity and to_entity must be txids'); }
    const budget = new Budget(GRAPH_LIMITS.fetchBudget);
    const parent = new Map<string, { txid: string; edge: GraphEdge }>();
    const queue: { txid: string; depth: number }[] = [{ txid: from, depth: 0 }];
    const seen = new Set<string>([from]);
    let found = false;
    let depthLimited = false;
    if (from === to) {
      budget.take();
      const tx = await readIndex(() => this.index.transaction(from));
      checkedTransaction(tx, from);
      found = true;
    }
    while (queue.length > 0 && !found) {
      const current = queue.shift() as { txid: string; depth: number };
      if (current.depth >= GRAPH_LIMITS.maxHops) { depthLimited = true; continue; }
      if (!budget.take()) { break; }
      let tx: IEsploraApi.Transaction;
      tx = await readIndex(() => this.index.transaction(current.txid));
      checkedTransaction(tx, current.txid);
      if (!budget.take()) { break; }
      let outspends: IEsploraApi.Outspend[] = [];
      outspends = checkedOutspends(tx, await readIndex(() => this.index.outspends(current.txid)));
      for (let index = 0; index < outspends.length; index++) {
        const spend = outspends[index];
        if (!spend?.spent || !spend.txid || seen.has(spend.txid)) { continue; }
        seen.add(spend.txid);
        parent.set(spend.txid, { txid: current.txid, edge: { source_id: current.txid, target_id: spend.txid, value_sats: tx.vout[index]?.value ?? 0, vout: index, spending_txid: spend.txid, edge_type: 'output' } });
        if (spend.txid === to) { found = true; break; }
        queue.push({ txid: spend.txid, depth: current.depth + 1 });
      }
    }
    const nodeSequence: string[] = [];
    const edgeSequence: GraphEdge[] = [];
    if (found) {
      let cursor = to;
      nodeSequence.unshift(cursor);
      while (cursor !== from) {
        const step = parent.get(cursor);
        if (!step) { break; }
        edgeSequence.unshift(step.edge);
        cursor = step.txid;
        nodeSequence.unshift(cursor);
      }
    }
    return {
      network: config.MEMPOOL.NETWORK, from_entity: from, to_entity: to, path_found: found, total_hops: found ? edgeSequence.length : 0,
      // The value that can traverse the whole path is bounded by its thinnest edge.
      total_value_transferred_sats: null,
      value_upper_bound_sats: found && edgeSequence.length ? Math.min(...edgeSequence.map(edge => edge.value_sats)) : null,
      transfer_scope: 'Observed transaction connectivity only. Path bottleneck upper bound only, not a traced or achievable transfer amount; fungible mixed inputs do not establish exact funds transferred.',
      node_sequence: nodeSequence, edge_sequence: edgeSequence, search_exhausted: !found && (depthLimited || budget.exhausted() || queue.length > 0), fetches: budget.used,
    };
  }

  private caseView(row: GraphCaseRow): SavedGraphCase {
    const document = row.document as Partial<SavedGraphCase>;
    return {
      case_id: row.case_id, owner_id: row.owner_id, title: String(document.title ?? ''), root_entity: String(document.root_entity ?? ''), hops: Number(document.hops ?? 2),
      nodes_count: Number(document.nodes_count ?? 0), filters: (document.filters as Record<string, unknown>) ?? {}, layout: (document.layout as Record<string, unknown>) ?? {},
      notes: String(document.notes ?? ''), is_shared: Boolean(document.is_shared), share_token: document.share_token, created_at: row.created_at, updated_at: row.updated_at,
    };
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async saveCase(owner: AuthenticatedOwner, title: unknown, rootEntity: unknown, hops: unknown, filters: unknown, layout: unknown, notes: unknown, nodesCount: unknown): Promise<SavedGraphCase> {
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > GRAPH_LIMITS.caseTitle) { throw new IdentityError('invalid_title', `title must be 1 to ${GRAPH_LIMITS.caseTitle} characters`, 400); }
    const root = String(rootEntity ?? '').trim();
    TxGraphService.classify(root);
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > GRAPH_LIMITS.caseNotes)) { throw new IdentityError('invalid_notes', `notes must be at most ${GRAPH_LIMITS.caseNotes} characters`, 400); }
    const store = ownerStore();
    if ((await store.countGraphCases(owner.owner_id, config.MEMPOOL.NETWORK)) >= GRAPH_LIMITS.casesPerOwner) { throw new IdentityError('quota', `an owner may keep at most ${GRAPH_LIMITS.casesPerOwner} cases`, 409); }
    const now = new Date().toISOString();
    const document = {
      title: title.trim(), root_entity: root, hops: Math.min(Math.max(1, Number(hops) || 2), GRAPH_LIMITS.maxHops), nodes_count: Math.max(0, Math.floor(Number(nodesCount) || 0)),
      filters: filters && typeof filters === 'object' ? filters : {}, layout: layout && typeof layout === 'object' ? layout : {}, notes: typeof notes === 'string' ? notes : '', is_shared: false,
    };
    const row: GraphCaseRow = { case_id: EventEnvelopeValidator.generateUuidV7(), owner_id: owner.owner_id, network: config.MEMPOOL.NETWORK, document, created_at: now, updated_at: now };
    await store.insertGraphCase(row);
    return this.caseView(row);
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getCases(owner: AuthenticatedOwner): Promise<SavedGraphCase[]> {
    return (await ownerStore().listGraphCases(owner.owner_id, config.MEMPOOL.NETWORK)).map(row => this.caseView(row));
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async getCaseById(owner: AuthenticatedOwner, caseId: string): Promise<SavedGraphCase | null> {
    const row = await ownerStore().getGraphCase(owner.owner_id, config.MEMPOOL.NETWORK, caseId);
    return row ? this.caseView(row) : null;
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async updateCase(owner: AuthenticatedOwner, caseId: string, updates: Partial<Pick<SavedGraphCase, 'title' | 'notes' | 'layout' | 'filters' | 'is_shared'>>): Promise<SavedGraphCase | null> {
    const store = ownerStore();
    const row = await store.getGraphCase(owner.owner_id, config.MEMPOOL.NETWORK, caseId);
    if (!row) { return null; }
    const document = { ...row.document } as Record<string, unknown>;
    if (typeof updates.title === 'string' && updates.title.trim() && updates.title.length <= GRAPH_LIMITS.caseTitle) { document.title = updates.title.trim(); }
    if (typeof updates.notes === 'string' && updates.notes.length <= GRAPH_LIMITS.caseNotes) { document.notes = updates.notes; }
    if (updates.layout && typeof updates.layout === 'object') { document.layout = updates.layout; }
    if (updates.filters && typeof updates.filters === 'object') { document.filters = updates.filters; }
    if (typeof updates.is_shared === 'boolean') {
      document.is_shared = updates.is_shared;
      if (updates.is_shared && !document.share_token) { document.share_token = crypto.randomBytes(16).toString('hex'); }
    }
    const now = new Date().toISOString();
    await store.updateGraphCase(owner.owner_id, config.MEMPOOL.NETWORK, caseId, document, now);
    return this.caseView({ ...row, document, updated_at: now });
  }

  /** @asyncUnsafe Callers turn a rejection into an exact HTTP answer. */
  public async deleteCase(owner: AuthenticatedOwner, caseId: string): Promise<boolean> {
    return ownerStore().deleteGraphCase(owner.owner_id, config.MEMPOOL.NETWORK, caseId);
  }
}

export const txGraphService = TxGraphService.getInstance();
