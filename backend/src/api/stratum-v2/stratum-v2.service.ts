import {
  StratumV2JobDeclaration,
  StratumV2RoleStatus,
  StratumV2Template,
} from './stratum-v2.types';

const ROLES: StratumV2RoleStatus[] = [
  {
    role: 'job-declarator',
    name: 'Universe SV2 Job Declarator (Frankfurt)',
    endpoint: 'sv2.eu.bitcoinuniverse.io:34255',
    noiseProtocolSecured: true,
    negotiatedSubprotocols: ['mining', 'job-declaration', 'template-distribution'],
    connectedDownstreams: 42,
    uptimeSec: 894000,
    status: 'active',
  },
  {
    role: 'template-provider',
    name: 'Universe Local Node Template Provider',
    endpoint: '127.0.0.1:8442',
    noiseProtocolSecured: true,
    negotiatedSubprotocols: ['template-distribution'],
    connectedDownstreams: 4,
    uptimeSec: 894000,
    status: 'active',
  },
];

const TEMPLATES: StratumV2Template[] = [
  {
    templateId: 'sv2-tmpl-860143-01',
    blockHeight: 860143,
    coinbaseTxValueSats: '317420194',
    declaredTxCount: 3215,
    poolSelectedTxCount: 3210,
    feeRateDeltaSatVb: 0.2,
    totalWeight: 3993800,
    status: 'mining',
    generatedAt: Math.floor(Date.now() / 1000) - 25,
  },
];

const DECLARATIONS: StratumV2JobDeclaration[] = [
  {
    jobId: 'sv2-job-948102',
    templateId: 'sv2-tmpl-860143-01',
    declaratorId: 'Universe SV2 Job Declarator (Frankfurt)',
    minerDeclaredTxids: ['e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f'],
    poolModifiedTxids: [],
    acceptedByPool: true,
    latencyMs: 14,
  },
];

export class StratumV2Service {
  /** @asyncSafe */
  public async $getRoles(): Promise<StratumV2RoleStatus[]> {
    return ROLES;
  }

  /** @asyncSafe */

  public async $getTemplates(): Promise<StratumV2Template[]> {
    return TEMPLATES;
  }

  /** @asyncSafe */

  public async $getDeclarations(): Promise<StratumV2JobDeclaration[]> {
    return DECLARATIONS;
  }
}

export const stratumV2Service = new StratumV2Service();
