import {
  NodeSecurityOverview,
  SecurityAdvisory,
  NodeInventoryItem,
  SoftwareRelease,
  UpgradeWavePlan,
  ArtifactVerificationState,
} from './node-security.models';

export class NodeSecurityService {
  private releases: SoftwareRelease[] = [
    {
      release_id: 'btc-core-28.0',
      project: 'Bitcoin Core',
      version: '28.0',
      release_date_utc: '2024-10-02T00:00:00Z',
      official_tarball_sha256: '94aeec3feab29948831980839958102839485720192847582910485739201948',
      signature_verified: true,
      release_notes_url: 'https://bitcoincore.org/en/releases/28.0/',
      eol_status: 'supported',
    },
    {
      release_id: 'btc-core-27.1',
      project: 'Bitcoin Core',
      version: '27.1',
      release_date_utc: '2024-06-11T00:00:00Z',
      official_tarball_sha256: '4c93322bb60e44120b98a0a40f0aa13d48cd4b5e8808041e73a0011223344556',
      signature_verified: true,
      release_notes_url: 'https://bitcoincore.org/en/releases/27.1/',
      eol_status: 'supported',
    },
    {
      release_id: 'btc-core-24.0.1',
      project: 'Bitcoin Core',
      version: '24.0.1',
      release_date_utc: '2022-12-12T00:00:00Z',
      official_tarball_sha256: '1adf6a15eb00112233445566778899aabbccddeeff00112233445566778899aa',
      signature_verified: true,
      release_notes_url: 'https://bitcoincore.org/en/releases/24.0.1/',
      eol_status: 'end_of_life',
    },
    {
      release_id: 'lnd-0.18.3',
      project: 'LND',
      version: '0.18.3-beta',
      release_date_utc: '2024-08-15T00:00:00Z',
      official_tarball_sha256: '5dbecdc074cdd3b1ca8bf3206cb0f8b2c76e54a01234567890abcdef12345678',
      signature_verified: true,
      release_notes_url: 'https://github.com/lightningnetwork/lnd/releases/tag/v0.18.3-beta',
      eol_status: 'supported',
    },
  ];

  private advisories: SecurityAdvisory[] = [
    {
      advisory_id: 'BIP-SEC-2024-01',
      project: 'Bitcoin Core',
      title: 'Remote Crash via Malformed Compact Block Tx Request',
      severity: 'high',
      cve_id: 'CVE-2024-35202',
      affected_versions: '>=24.0, <27.0',
      fixed_versions: '>=27.0, 26.2',
      affected_configuration: ['blocksonly=0', 'peerbloomfilters=1'],
      affected_platforms: ['Linux', 'Windows', 'macOS'],
      attack_preconditions: 'Peer connected via P2P relay in high bandwidth compact block mode.',
      impact_summary: 'Unchecked assertion failure triggering bitcoind process termination.',
      mitigation: 'Upgrade to Bitcoin Core 27.0 or higher. Set blocksonly=1 if immediate upgrade is not feasible.',
      published_at_utc: '2024-07-02T12:00:00Z',
      source_url: 'https://bitcoincore.org/en/2024/07/02/disclose-compact-blocks/',
      signature_status: 'pgp_verified',
    },
    {
      advisory_id: 'LND-SEC-2024-02',
      project: 'LND',
      title: 'Gossip Message Channel Announcement Deserialization Hang',
      severity: 'medium',
      affected_versions: '<0.18.0',
      fixed_versions: '>=0.18.0',
      attack_preconditions: 'Peer broadcasting crafted gossip message packets.',
      impact_summary: 'Excessive CPU consumption in gossip syncer thread.',
      mitigation: 'Upgrade to LND 0.18.0 or disable legacy gossip sync.',
      published_at_utc: '2024-05-20T14:00:00Z',
      source_url: 'https://github.com/lightningnetwork/lnd/security/advisories',
      signature_status: 'pgp_verified',
    },
  ];

  private fleet: NodeInventoryItem[] = [
    {
      node_id: 'node-ashburn-core-01',
      software: 'Bitcoin Core',
      version: '28.0',
      source_commit: '1adf6a15eb0',
      build_hash: '94aeec3feab2',
      os_arch: 'Ubuntu 24.04 / x86_64',
      network: 'mainnet',
      rpc_exposure_boundary: 'localhost_only',
      tor_enabled: true,
      i2p_enabled: true,
      bip324_v2_transport: true,
      asmap_active: true,
      pruned: false,
      wallet_enabled: false,
      external_signer: false,
      last_verified_utc: '2026-09-04T17:50:00Z',
      exposure_status: 'not_affected',
    },
    {
      node_id: 'node-frankfurt-core-02',
      software: 'Bitcoin Core',
      version: '27.1',
      source_commit: '4c93322bb60',
      build_hash: 'ca6980eeb12',
      os_arch: 'Ubuntu 24.04 / x86_64',
      network: 'mainnet',
      rpc_exposure_boundary: 'localhost_only',
      tor_enabled: true,
      i2p_enabled: false,
      bip324_v2_transport: true,
      asmap_active: true,
      pruned: false,
      wallet_enabled: false,
      external_signer: false,
      last_verified_utc: '2026-09-04T17:52:00Z',
      exposure_status: 'not_affected',
    },
    {
      node_id: 'node-legacy-archive-03',
      software: 'Bitcoin Core',
      version: '24.0.1',
      source_commit: '5dbecdc074c',
      build_hash: '8808041e73a',
      os_arch: 'Debian 12 / x86_64',
      network: 'mainnet',
      rpc_exposure_boundary: 'private_subnet',
      tor_enabled: false,
      i2p_enabled: false,
      bip324_v2_transport: false,
      asmap_active: false,
      pruned: false,
      wallet_enabled: false,
      external_signer: false,
      last_verified_utc: '2026-09-04T16:00:00Z',
      exposure_status: 'affected',
    },
  ];

  public getOverview(): NodeSecurityOverview {
    return {
      total_fleet_nodes_monitored: this.fleet.length,
      healthy_nodes_count: this.fleet.filter((n) => n.exposure_status === 'not_affected').length,
      exposed_advisories_count: this.fleet.filter((n) => n.exposure_status === 'affected').length,
      eol_nodes_count: 1,
      latest_software_releases: this.releases,
      active_advisories: this.advisories,
      fleet_summary: this.fleet,
    };
  }

  public listReleases(): { releases: SoftwareRelease[] } {
    return { releases: this.releases };
  }

  public listAdvisories(): { advisories: SecurityAdvisory[] } {
    return { advisories: this.advisories };
  }

  public getAdvisory(advisoryId: string): SecurityAdvisory | undefined {
    return this.advisories.find((a) => a.advisory_id === advisoryId);
  }

  public listFleet(): { fleet: NodeInventoryItem[] } {
    return { fleet: this.fleet };
  }

  public getNode(nodeId: string): NodeInventoryItem | undefined {
    return this.fleet.find((n) => n.node_id === nodeId);
  }

  public getNodeExposures(nodeId: string): any {
    const node = this.getNode(nodeId);
    if (!node) return null;
    const isVulnerable = node.version === '24.0.1';
    return {
      node_id: nodeId,
      software: node.software,
      version: node.version,
      exposures: isVulnerable
        ? [
            {
              advisory_id: 'BIP-SEC-2024-01',
              severity: 'high',
              status: 'affected',
              recommended_action: 'Upgrade node to Bitcoin Core 28.0',
            },
          ]
        : [],
    };
  }

  public listArtifacts(): any {
    return {
      artifacts: this.releases.map((r) => ({
        release_id: r.release_id,
        project: r.project,
        version: r.version,
        sha256: r.official_tarball_sha256,
        signature_verified: r.signature_verified,
        verification_state: 'official_checksum_matched' as ArtifactVerificationState,
      })),
    };
  }

  public verifyArtifact(artifact: { sha256?: string; version?: string }): { verified: boolean; state: ArtifactVerificationState } {
    const matched = this.releases.some((r) => r.official_tarball_sha256 === artifact.sha256);
    return {
      verified: matched,
      state: matched ? 'official_checksum_matched' : 'unverified',
    };
  }

  public createUpgradePlan(params: { from_version: string; target_version: string }): UpgradeWavePlan {
    return {
      plan_id: `upg-plan-${Date.now()}`,
      target_software: 'Bitcoin Core',
      from_version: params.from_version || '24.0.1',
      target_version: params.target_version || '28.0',
      nodes_count: 1,
      intermediate_versions_required: ['26.2'],
      configuration_changes_required: [
        {
          option: 'deprecatedrpc=accounts',
          action: 'removed',
          notes: 'Legacy accounts RPC removed in 26.0; migrate to descriptor wallets or standalone RPCs.',
        },
        {
          option: 'v2transport=1',
          action: 'added',
          notes: 'BIP324 v2 transport encrypted P2P connections enabled by default in 28.0.',
        },
      ],
      canary_stages: [
        {
          stage_number: 1,
          node_ids: ['node-legacy-archive-03'],
          verification_wait_minutes: 30,
        },
      ],
      rollback_boundary: 'Snapshot data directory before applying 26.2 chainstate upgrade.',
      estimated_downtime_seconds: 180,
    };
  }
}

export default new NodeSecurityService();
