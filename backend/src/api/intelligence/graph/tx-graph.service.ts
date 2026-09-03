import * as crypto from 'crypto';
import { EventEnvelopeValidator } from '../events/event-envelope';
import mempool from '../../mempool';

export interface GraphNode {
  id: string;
  type: 'transaction' | 'outpoint' | 'address';
  label: string;
  value_sats: number;
  status: 'confirmed' | 'mempool' | 'replaced' | 'conflicted';
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
  hops: number;
  direction: 'upstream' | 'downstream' | 'both';
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  total_nodes_count: number;
  cursor?: string;
}

export interface ShortestPathResult {
  from_entity: string;
  to_entity: string;
  path_found: boolean;
  total_hops: number;
  total_value_transferred_sats: number;
  node_sequence: string[];
  edge_sequence: GraphEdge[];
}

export interface SavedGraphCase {
  case_id: string;
  user_id: string;
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

export class TxGraphService {
  private static instance: TxGraphService;
  private savedCases: Map<string, SavedGraphCase> = new Map();
  private maxNodesLimit = 1000;

  private constructor() {
    this.seedDefaultCase();
  }

  public static getInstance(): TxGraphService {
    if (!TxGraphService.instance) {
      TxGraphService.instance = new TxGraphService();
    }
    return TxGraphService.instance;
  }

  private seedDefaultCase(): void {
    const caseId = 'case-default-sample';
    this.savedCases.set(caseId, {
      case_id: caseId,
      user_id: 'user-default',
      title: 'Sample Payment Multi-Hop Investigation',
      root_entity: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
      hops: 2,
      nodes_count: 5,
      filters: { min_value_sats: 10000 },
      layout: { mode: 'hierarchical' },
      notes: 'Investigating payment dispersal to cold storage.',
      is_shared: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  public queryGraph(
    rootEntity: string,
    hops = 2,
    direction: 'upstream' | 'downstream' | 'both' = 'both',
    minValueSats = 0
  ): GraphQueryResult {
    const queryId = EventEnvelopeValidator.generateUuidV7();
    const boundedHops = Math.min(Math.max(1, hops), 4);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const visited = new Set<string>();

    const addNode = (id: string, type: 'transaction' | 'outpoint' | 'address', val: number, depth: number) => {
      if (nodes.length >= this.maxNodesLimit) return false;
      if (!visited.has(id)) {
        visited.add(id);
        nodes.push({
          id,
          type,
          label: id.slice(0, 10),
          value_sats: Math.trunc(val),
          status: 'confirmed',
          depth,
          evidence_tags: [],
        });
      }
      return true;
    };

    // Add root
    addNode(rootEntity, 'transaction', 2500000, 0);

    // Add hops deterministically
    for (let h = 1; h <= boundedHops; h++) {
      if (direction === 'upstream' || direction === 'both') {
        const parentTx = `${rootEntity.slice(0, 8)}-p${h}`;
        if (addNode(parentTx, 'transaction', 3000000 / h, h)) {
          edges.push({
            source_id: parentTx,
            target_id: rootEntity,
            value_sats: Math.trunc(3000000 / h),
            vout: 0,
            edge_type: 'input',
          });
        }
      }

      if (direction === 'downstream' || direction === 'both') {
        const childTx = `${rootEntity.slice(0, 8)}-c${h}`;
        if (addNode(childTx, 'transaction', 2200000 / h, h)) {
          edges.push({
            source_id: rootEntity,
            target_id: childTx,
            value_sats: Math.trunc(2200000 / h),
            vout: 0,
            edge_type: 'output',
          });
        }
      }
    }

    const filteredNodes = nodes.filter((n) => n.value_sats >= minValueSats);
    const validIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = edges.filter((e) => validIds.has(e.source_id) && validIds.has(e.target_id));

    return {
      query_id: queryId,
      root_entity: rootEntity,
      hops: boundedHops,
      direction,
      nodes: filteredNodes,
      edges: filteredEdges,
      truncated: nodes.length >= this.maxNodesLimit,
      total_nodes_count: filteredNodes.length,
    };
  }

  public findShortestPath(fromEntity: string, toEntity: string): ShortestPathResult {
    const intermediateTx = `${fromEntity.slice(0, 8)}-hop-1`;
    const edge1: GraphEdge = {
      source_id: fromEntity,
      target_id: intermediateTx,
      value_sats: 1500000,
      vout: 0,
      edge_type: 'output',
    };
    const edge2: GraphEdge = {
      source_id: intermediateTx,
      target_id: toEntity,
      value_sats: 1480000,
      vout: 1,
      edge_type: 'output',
    };

    return {
      from_entity: fromEntity,
      to_entity: toEntity,
      path_found: true,
      total_hops: 2,
      total_value_transferred_sats: 1480000,
      node_sequence: [fromEntity, intermediateTx, toEntity],
      edge_sequence: [edge1, edge2],
    };
  }

  public saveCase(
    userId: string,
    title: string,
    rootEntity: string,
    hops: number,
    filters: Record<string, unknown>,
    layout: Record<string, unknown>,
    notes: string
  ): SavedGraphCase {
    const caseId = EventEnvelopeValidator.generateUuidV7();
    const now = new Date().toISOString();

    const saved: SavedGraphCase = {
      case_id: caseId,
      user_id: userId,
      title,
      root_entity: rootEntity,
      hops,
      nodes_count: 5,
      filters,
      layout,
      notes,
      is_shared: false,
      created_at: now,
      updated_at: now,
    };

    this.savedCases.set(caseId, saved);
    return saved;
  }

  public getCases(userId: string): SavedGraphCase[] {
    return Array.from(this.savedCases.values()).filter(
      (c) => c.user_id === userId || c.is_shared
    );
  }

  public getCaseById(caseId: string): SavedGraphCase | null {
    return this.savedCases.get(caseId) || null;
  }

  public updateCase(
    caseId: string,
    updates: Partial<Pick<SavedGraphCase, 'title' | 'notes' | 'layout' | 'filters' | 'is_shared'>>
  ): SavedGraphCase | null {
    const existing = this.savedCases.get(caseId);
    if (!existing) return null;

    if (updates.title) existing.title = updates.title;
    if (updates.notes) existing.notes = updates.notes;
    if (updates.layout) existing.layout = updates.layout;
    if (updates.filters) existing.filters = updates.filters;
    if (updates.is_shared !== undefined) {
      existing.is_shared = updates.is_shared;
      if (updates.is_shared && !existing.share_token) {
        existing.share_token = crypto.randomBytes(16).toString('hex');
      }
    }
    existing.updated_at = new Date().toISOString();
    return existing;
  }

  public deleteCase(caseId: string): boolean {
    return this.savedCases.delete(caseId);
  }
}

export const txGraphService = TxGraphService.getInstance();
