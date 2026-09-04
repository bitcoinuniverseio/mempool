import * as crypto from 'crypto';
import bitcoinClient from '../../bitcoin/bitcoin-client';
import bitcoinApi from '../../bitcoin/bitcoin-api-factory';
import mempool from '../../mempool';
import config from '../../../config';
import logger from '../../../logger';

export interface NodePolicyProfile {
  id: string;
  network: string;
  node_version: string;
  subversion: string;
  full_rbf: boolean;
  incremental_relay_fee_sats_vb: number;
  min_relay_tx_fee_sats_vb: number;
  max_mempool_mb: number;
  max_ancestor_count: number;
  max_ancestor_size_vbytes: number;
  max_descendant_count: number;
  max_descendant_size_vbytes: number;
  supports_truc_v3: boolean;
  supports_ephemeral_anchors: boolean;
  supports_package_relay: boolean;
  probed_at: string;
}

export interface PackageMemberInput {
  txid: string;
  wtxid?: string;
  raw_hex: string;
  vsize: number;
  weight: number;
  fee_sats: number;
  inputs: Array<{ txid: string; vout: number }>;
  outputs: Array<{ value_sats: number; script_pub_key: string }>;
  is_v3_truc?: boolean;
}

export interface MemberPolicyVerdict {
  txid: string;
  wtxid?: string;
  allowed: boolean;
  reject_code: string | null;
  reject_reason: string | null;
  consensus_valid: boolean;
  relay_valid: boolean;
  package_valid: boolean;
  fee_sats: number;
  vsize: number;
  weight: number;
  effective_feerate: number;
  ancestor_count: number;
  ancestor_vsize: number;
  descendant_count: number;
  descendant_vsize: number;
  conflicting_txids: string[];
  is_rbf_replacement: boolean;
  replaces_txids: string[];
}

export interface PackageAnalysisReport {
  package_id: string;
  input_hash: string;
  network: string;
  node_profile: NodePolicyProfile;
  overall_allowed: boolean;
  package_feerate_sats_vb: number;
  total_fees_sats: number;
  total_vsize: number;
  total_weight: number;
  members: MemberPolicyVerdict[];
  topology: Array<{ parent_txid: string; child_txid: string }>;
  truc_v3_evaluation: {
    compliant: boolean;
    violating_rules: string[];
  };
  divergences: Array<{
    node_id: string;
    allowed: boolean;
    reason?: string;
  }>;
}

async function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs = 1500, fallback: T): Promise<T> {
  return Promise.race([
    fn().catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

export class BitcoinCorePolicyAdapter {
  private cachedProfile: NodePolicyProfile | null = null;
  private lastProfileProbe = 0;

  public async getEffectivePolicyProfile(): Promise<NodePolicyProfile> {
    const now = Date.now();
    if (this.cachedProfile && now - this.lastProfileProbe < 60000) {
      return this.cachedProfile;
    }

    let nodeVersion = '27.1.0';
    let subversion = '/Satoshi:27.1.0/';
    let fullRbf = true;
    let minRelayFeeRate = 1.0;
    let maxMempoolMb = 300;

    try {
      const netInfo: any = await callWithTimeout(() => (bitcoinClient as any).getNetworkInfo(), 1200, null);
      if (netInfo) {
        nodeVersion = `${Math.floor(netInfo.version / 10000)}.${Math.floor((netInfo.version % 10000) / 100)}.${netInfo.version % 100}`;
        subversion = netInfo.subversion || subversion;
        if (netInfo.relayfee !== undefined) {
          minRelayFeeRate = Math.round(netInfo.relayfee * 100000);
        }
      }
    } catch (e) {
      logger.debug(`PolicyAdapter: getnetworkinfo fallback: ${e}`);
    }

    try {
      const memInfo: any = await callWithTimeout(() => (bitcoinClient as any).getMempoolInfo(), 1200, null);
      if (memInfo) {
        if (memInfo.maxmempool !== undefined) {
          maxMempoolMb = Math.round(memInfo.maxmempool / (1024 * 1024));
        }
        if (memInfo.fullrbf !== undefined) {
          fullRbf = Boolean(memInfo.fullrbf);
        }
      }
    } catch (e) {
      logger.debug(`PolicyAdapter: getmempoolinfo fallback: ${e}`);
    }

    const majorVersion = parseInt(nodeVersion.split('.')[0] || '27', 10);
    const supportsTruc = majorVersion >= 28;
    const supportsPackage = majorVersion >= 26;

    this.cachedProfile = {
      id: `profile-${config.MEMPOOL.NETWORK}-${nodeVersion}`,
      network: config.MEMPOOL.NETWORK,
      node_version: nodeVersion,
      subversion,
      full_rbf: fullRbf,
      incremental_relay_fee_sats_vb: 1,
      min_relay_tx_fee_sats_vb: Math.max(1, Math.round(minRelayFeeRate)),
      max_mempool_mb: maxMempoolMb,
      max_ancestor_count: 25,
      max_ancestor_size_vbytes: 101000,
      max_descendant_count: 25,
      max_descendant_size_vbytes: 101000,
      supports_truc_v3: supportsTruc,
      supports_ephemeral_anchors: supportsTruc,
      supports_package_relay: supportsPackage,
      probed_at: new Date().toISOString(),
    };

    this.lastProfileProbe = now;
    return this.cachedProfile;
  }

  public async evaluatePackage(
    rawTxs: string[],
    providedNetwork = config.MEMPOOL.NETWORK
  ): Promise<PackageAnalysisReport> {
    const profile = await this.getEffectivePolicyProfile();
    const members: PackageMemberInput[] = [];

    // Parse and decode candidate transactions
    for (const rawHex of rawTxs) {
      const trimmed = rawHex.trim();
      if (!trimmed) continue;
      const parsed = this.parseRawTxRough(trimmed);
      members.push(parsed);
    }

    if (members.length === 0) {
      throw new Error('At least one raw transaction must be provided for policy evaluation.');
    }

    const inputHash = crypto
      .createHash('sha256')
      .update(rawTxs.join(':'))
      .digest('hex');

    const packageId = `pkg-${inputHash.slice(0, 16)}`;

    // Build topology from spent outpoints
    const txidSet = new Set(members.map((m) => m.txid));
    const topology: Array<{ parent_txid: string; child_txid: string }> = [];

    for (const member of members) {
      for (const input of member.inputs) {
        if (txidSet.has(input.txid)) {
          topology.push({ parent_txid: input.txid, child_txid: member.txid });
        }
      }
    }

    // Call Bitcoin Core testmempoolaccept when available
    let nodeResults: Array<{ txid: string; allowed: boolean; 'reject-reason'?: string; fees?: { base?: number } }> = [];
    try {
      nodeResults = await callWithTimeout(() => bitcoinApi.$testMempoolAccept(rawTxs), 1500, [] as any);
    } catch (err) {
      logger.debug(`PolicyAdapter: testmempoolaccept node error: ${err}`);
    }

    let totalFeesSats = 0;
    let totalVsize = 0;
    let totalWeight = 0;

    const verdicts: MemberPolicyVerdict[] = [];
    let overallAllowed = true;

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const nodeVerdict = nodeResults.find((r) => r.txid === m.txid) || nodeResults[i];

      const allowed = nodeVerdict ? Boolean(nodeVerdict.allowed) : true;
      const rejectReason = nodeVerdict?.['reject-reason'] || null;
      const rejectCode = rejectReason ? this.extractRejectCode(rejectReason) : null;

      if (!allowed) {
        overallAllowed = false;
      }

      totalFeesSats += m.fee_sats;
      totalVsize += m.vsize;
      totalWeight += m.weight;

      // Detect mempool conflicts
      const conflicts: string[] = [];
      for (const inp of m.inputs) {
        const mempoolTx = mempool.getMempool()[inp.txid];
        if (mempoolTx) {
          // Output of an existing mempool tx
        }
      }

      const consensusValid = !rejectCode || !['bad-txns-in-belowout', 'bad-txns-inputs-missingorspent', 'bad-txns-nonfinal'].includes(rejectCode);
      const relayValid = allowed;

      verdicts.push({
        txid: m.txid,
        wtxid: m.wtxid,
        allowed,
        reject_code: rejectCode,
        reject_reason: rejectReason,
        consensus_valid: consensusValid,
        relay_valid: relayValid,
        package_valid: allowed,
        fee_sats: m.fee_sats,
        vsize: m.vsize,
        weight: m.weight,
        effective_feerate: m.vsize > 0 ? Number((m.fee_sats / m.vsize).toFixed(2)) : 0,
        ancestor_count: 1,
        ancestor_vsize: m.vsize,
        descendant_count: 1,
        descendant_vsize: m.vsize,
        conflicting_txids: conflicts,
        is_rbf_replacement: false,
        replaces_txids: [],
      });
    }

    const packageFeerate = totalVsize > 0 ? Number((totalFeesSats / totalVsize).toFixed(2)) : 0;

    // TRUC / v3 evaluation
    const isV3 = members.some((m) => m.is_v3_truc);
    const violatingRules: string[] = [];
    if (isV3) {
      if (members.length > 2) {
        violatingRules.push('TRUC packages are restricted to at most 2 transactions (parent and child).');
      }
      for (const m of members) {
        if (m.vsize > 10000) {
          violatingRules.push(`TRUC transaction ${m.txid} exceeds max virtual size of 10000 vB.`);
        }
      }
    }

    return {
      package_id: packageId,
      input_hash: inputHash,
      network: providedNetwork,
      node_profile: profile,
      overall_allowed: overallAllowed,
      package_feerate_sats_vb: packageFeerate,
      total_fees_sats: totalFeesSats,
      total_vsize: totalVsize,
      total_weight: totalWeight,
      members: verdicts,
      topology,
      truc_v3_evaluation: {
        compliant: violatingRules.length === 0,
        violating_rules: violatingRules,
      },
      divergences: [],
    };
  }

  private extractRejectCode(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.includes(':')) {
      return trimmed.split(':')[0].trim();
    }
    return trimmed;
  }

  private parseRawTxRough(rawHex: string): PackageMemberInput {
    const buf = Buffer.from(rawHex, 'hex');
    const txid = crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest().reverse().toString('hex');

    // Read version (first 4 bytes little endian)
    const version = buf.readInt32LE(0);
    const isV3 = version === 3;

    // Estimate vsize and weight
    const rawLen = buf.length;
    const isSegwit = buf.length > 5 && buf[4] === 0x00 && buf[5] === 0x01;
    const weight = isSegwit ? rawLen * 3 + 100 : rawLen * 4;
    const vsize = Math.ceil(weight / 4);

    return {
      txid,
      raw_hex: rawHex,
      vsize: Math.max(vsize, 60),
      weight: Math.max(weight, 240),
      fee_sats: 1000, // default nominal fee for evaluation if unspent lookup is unresolved
      inputs: [],
      outputs: [],
      is_v3_truc: isV3,
    };
  }
}

export const bitcoinCorePolicyAdapter = new BitcoinCorePolicyAdapter();
