import {
  NodeSecurityOverview,
  SecurityAdvisory,
  NodeInventoryItem,
  SoftwareRelease,
  UpgradeWavePlan,
  ArtifactVerificationState,
} from './node-security.models';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class NodeSecurityEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const releaseManifestUnavailable =
  'Release observations are unavailable. Release checksums, signature status and lifecycle state require the owned release manifest mirror (SHA256SUMS and SHA256SUMS.asc for each project, verified against the owned trusted signer key set), which is not connected on this deployment.';

const advisoryFeedUnavailable =
  'Advisory observations are unavailable. Advisories and their signature status require the owned advisory feed (project disclosures mirrored and PGP-verified by this backend), which is not connected on this deployment.';

const fleetInventoryUnavailable =
  'Fleet observations are unavailable. Node inventory, per-node exposure and upgrade planning require the owned fleet inventory (version, build and configuration reported by each managed node to this backend), which is not connected on this deployment.';

/**
 * Node security evidence.
 *
 * Releases, advisories, fleet inventory, exposures and upgrade plans are
 * observations and need their owned sources; a deployment without them gets a
 * 503 that names the missing one. Artifact verification stays as the input
 * boundary it already was: it reports the absent manifest and verifies nothing.
 */
export class NodeSecurityService {
  public getOverview(): NodeSecurityOverview {
    throw new NodeSecurityEvidenceError('unavailable-fleet-inventory', fleetInventoryUnavailable);
  }

  public listReleases(): { releases: SoftwareRelease[] } {
    throw new NodeSecurityEvidenceError('unavailable-release-manifest', releaseManifestUnavailable);
  }

  public listAdvisories(): { advisories: SecurityAdvisory[] } {
    throw new NodeSecurityEvidenceError('unavailable-advisory-feed', advisoryFeedUnavailable);
  }

  public getAdvisory(_advisoryId: string): SecurityAdvisory | undefined {
    throw new NodeSecurityEvidenceError('unavailable-advisory-feed', advisoryFeedUnavailable);
  }

  public listFleet(): { fleet: NodeInventoryItem[] } {
    throw new NodeSecurityEvidenceError('unavailable-fleet-inventory', fleetInventoryUnavailable);
  }

  public getNode(_nodeId: string): NodeInventoryItem | undefined {
    throw new NodeSecurityEvidenceError('unavailable-fleet-inventory', fleetInventoryUnavailable);
  }

  public getNodeExposures(_nodeId: string): never {
    throw new NodeSecurityEvidenceError('unavailable-fleet-inventory', fleetInventoryUnavailable);
  }

  public listArtifacts(): never {
    throw new NodeSecurityEvidenceError('unavailable-release-manifest', releaseManifestUnavailable);
  }

  public verifyArtifact(artifact: { sha256?: string; version?: string }): {
    verified: false; state: ArtifactVerificationState; stage: 'invalid-input' | 'unavailable-manifest'; error: string;
  } {
    if (!artifact || typeof artifact.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(artifact.sha256)
      || artifact.version !== undefined && (typeof artifact.version !== 'string' || !artifact.version.trim() || artifact.version.length > 128)) {
      return { verified: false, state: 'unverified', stage: 'invalid-input', error: 'A 32-byte SHA256 checksum and, if supplied, a nonempty release version are required.' };
    }
    return {
      verified: false, state: 'unverified', stage: 'unavailable-manifest',
      error: 'An authenticated release manifest, trusted signing keys and exact artifact/version binding are required. A supplied checksum matching a local catalogue entry does not verify an artifact.',
    };
  }

  public createUpgradePlan(_params: { from_version: string; target_version: string }): UpgradeWavePlan {
    throw new NodeSecurityEvidenceError('unavailable-fleet-inventory', fleetInventoryUnavailable);
  }
}

export default new NodeSecurityService();
