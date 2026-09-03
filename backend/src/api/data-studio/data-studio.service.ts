import {
  DatasetManifest,
  McpToolDeclaration,
  QueryRequest,
  QueryResult,
  StreamManifest,
} from './data-studio.types';

const DATASETS: DatasetManifest[] = [
  {
    id: 'bitcoin.blocks',
    name: 'Bitcoin Blocks',
    category: 'blockchain',
    description: 'Every confirmed Bitcoin block with fee totals, weights, and pool attributions.',
    updateFrequency: 'per-block',
    rowCountEstimate: '860000',
    sizeEstimateBytes: '420000000',
    supportedFormats: ['parquet', 'ndjson', 'csv', 'json'],
    fields: [
      { name: 'height', type: 'integer', description: 'Block height', primaryKey: true },
      { name: 'hash', type: 'string', description: 'Block header hash' },
      { name: 'timestamp', type: 'timestamp', description: 'Header timestamp in seconds' },
      { name: 'tx_count', type: 'integer', description: 'Number of transactions' },
      { name: 'size', type: 'integer', description: 'Total byte size' },
      { name: 'weight', type: 'integer', description: 'Block weight units' },
      { name: 'fees_sats', type: 'integer', description: 'Total fees collected in satoshis' },
      { name: 'pool_name', type: 'string', description: 'Attributed mining pool' },
    ],
  },
  {
    id: 'bitcoin.mempool',
    name: 'Mempool Transactions',
    category: 'mempool',
    description: 'Live unconfirmed transactions with cluster lineage and fee-rate linearizations.',
    updateFrequency: 'realtime',
    rowCountEstimate: '180000',
    sizeEstimateBytes: '110000000',
    supportedFormats: ['parquet', 'ndjson', 'json'],
    fields: [
      { name: 'txid', type: 'string', description: 'Transaction ID', primaryKey: true },
      { name: 'first_seen', type: 'timestamp', description: 'Observer arrival timestamp' },
      { name: 'fee_rate', type: 'decimal', description: 'Fee rate in sat/vB' },
      { name: 'vsize', type: 'integer', description: 'Virtual size in vbytes' },
      { name: 'rbf', type: 'boolean', description: 'BIP125 replace-by-fee signaling' },
      { name: 'cluster_id', type: 'string', description: 'Cluster identifier' },
    ],
  },
  {
    id: 'protocols.registry',
    name: 'Universe Protocol Registry',
    category: 'protocols',
    description: 'Every registered protocol family across Bitcoin, Fractal, and Dogecoin.',
    updateFrequency: 'daily',
    rowCountEstimate: '40',
    sizeEstimateBytes: '150000',
    supportedFormats: ['ndjson', 'json', 'csv'],
    fields: [
      { name: 'id', type: 'string', description: 'Standard protocol identifier', primaryKey: true },
      { name: 'name', type: 'string', description: 'Display name' },
      { name: 'chain', type: 'string', description: 'Underlying blockchain' },
      { name: 'family', type: 'string', description: 'Category family' },
      { name: 'release_status', type: 'string', description: 'Verification status' },
      { name: 'authority', type: 'string', description: 'First-party indexer authority' },
    ],
  },
];

const STREAMS: StreamManifest[] = [
  {
    id: 'stream.blocks',
    name: 'Live Block Stream',
    endpoint: '/api/v1/data/live/blocks',
    transport: 'sse',
    description: 'Server-Sent Events delivering newly confirmed blocks with fee summaries.',
    schemaRef: 'universe-block-event-v1',
    messageRatePerSec: 0.0016,
  },
  {
    id: 'stream.mempool',
    name: 'Live Mempool Transactions',
    endpoint: '/api/v1/data/live/mempool',
    transport: 'sse',
    description: 'Real-time feed of unconfirmed transactions as observed across Universe nodes.',
    schemaRef: 'universe-tx-event-v1',
    messageRatePerSec: 7.2,
  },
  {
    id: 'stream.protocols',
    name: 'Live Protocol Transitions',
    endpoint: '/api/v1/data/live/protocols',
    transport: 'sse',
    description: 'Real-time feed of verified protocol state transitions and transfers.',
    schemaRef: 'universe-protocol-event-v1',
    messageRatePerSec: 3.4,
  },
];

const MCP_TOOLS: McpToolDeclaration[] = [
  {
    name: 'get_transaction_flow',
    description: 'Inspect transaction value flows and protocol asset changes with zero third-party leakage.',
    parameters: {
      type: 'object',
      properties: {
        txid: { type: 'string', description: '64-character hex transaction ID' },
      },
      required: ['txid'],
    },
    sampleCall: '{"txid": "e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f"}',
  },
  {
    name: 'get_mempool_clusters',
    description: 'Fetch ancestor and descendant cluster package linearizations from local node memory.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', default: 20 },
      },
    },
    sampleCall: '{"limit": 10}',
  },
  {
    name: 'query_protocol_state',
    description: 'Read first-party verified state for any protocol family by identifier.',
    parameters: {
      type: 'object',
      properties: {
        protocol: { type: 'string', description: 'Protocol ID like ordinals, runes, alkanes' },
        object_id: { type: 'string', description: 'Item or asset identifier' },
      },
      required: ['protocol'],
    },
    sampleCall: '{"protocol": "runes", "object_id": "UNCOMMONSAT"}',
  },
];

export class DataStudioService {
  public async $getCatalog(): Promise<{ datasets: DatasetManifest[]; streams: StreamManifest[]; mcpTools: McpToolDeclaration[] }> {
    return {
      datasets: DATASETS,
      streams: STREAMS,
      mcpTools: MCP_TOOLS,
    };
  }

  public async $executeQuery(query: QueryRequest): Promise<QueryResult> {
    const dataset = DATASETS.find((d) => d.id === query.datasetId);
    if (!dataset) {
      throw new Error(`Dataset ${query.datasetId} does not exist`);
    }

    const columns = query.fields && query.fields.length > 0
      ? query.fields
      : dataset.fields.map((f) => f.name);

    let sampleRows: (unknown[])[] = [];

    if (query.datasetId === 'bitcoin.blocks') {
      sampleRows = [
        [860142, '0000000000000000000189274918274918274918274918274918274918274918', 1725301200, 3184, 1650420, 3992810, 4821090, 'Foundry USA'],
        [860141, '0000000000000000000291827391827391827391827391827391827391827391', 1725300600, 2910, 1540100, 3991200, 3910240, 'AntPool'],
        [860140, '0000000000000000000381729481729481729481729481729481729481729481', 1725300000, 3420, 1720890, 3993400, 5210900, 'F2Pool'],
      ];
    } else if (query.datasetId === 'bitcoin.mempool') {
      sampleRows = [
        ['e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f', 1725301820, 14.5, 218, true, 'cluster-84910'],
        ['b198374291847eabcf9817294817294817294817294817294817294817294817', 1725301815, 12.0, 142, false, 'cluster-84911'],
        ['a8b19e288924b17f9e855651c6b12f60a92d477839cf9e1d82136e0018d9bc34', 1725301810, 18.2, 340, true, 'cluster-84912'],
      ];
    } else {
      sampleRows = [
        ['ordinals', 'Ordinals', 'bitcoin', 'ORDINALS', 'VERIFIED READ ONLY', 'ord'],
        ['runes', 'Runes', 'bitcoin', 'RUNES', 'VERIFIED READ ONLY', 'ord'],
        ['op_inscriptions', 'OP_INSCRIPTIONS', 'bitcoin', 'OP DATA', 'VERIFIED READ ONLY', 'index-opinscriptions'],
      ];
    }

    const limit = query.limit ? Math.min(query.limit, 100) : 50;
    const paginated = sampleRows.slice(0, limit);

    return {
      datasetId: query.datasetId,
      rowCount: paginated.length,
      totalAvailable: Number(dataset.rowCountEstimate),
      executionTimeMs: 4.2,
      columns,
      rows: paginated,
    };
  }
}

export const dataStudioService = new DataStudioService();
