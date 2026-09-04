import nodeSecurityService from './node-security.service';

describe('NodeSecurityService', () => {
  it('should return overview with fleet nodes and active advisories', () => {
    const overview = nodeSecurityService.getOverview();
    expect(overview.total_fleet_nodes_monitored).toBeGreaterThanOrEqual(2);
    expect(overview.active_advisories.length).toBeGreaterThanOrEqual(2);
    expect(overview.latest_software_releases.length).toBeGreaterThanOrEqual(3);
  });

  it('should list official releases and track EOL versions', () => {
    const res = nodeSecurityService.listReleases();
    const versions = res.releases.map((r) => r.version);
    expect(versions).toContain('28.0');
    expect(versions).toContain('24.0.1');
    const eolRelease = res.releases.find((r) => r.version === '24.0.1');
    expect(eolRelease?.eol_status).toBe('end_of_life');
  });

  it('should evaluate fleet advisory exposures based on exact version and config', () => {
    const legacyExposures = nodeSecurityService.getNodeExposures('node-legacy-archive-03');
    expect(legacyExposures).toBeDefined();
    expect(legacyExposures.exposures.length).toBeGreaterThan(0);
    expect(legacyExposures.exposures[0].advisory_id).toBe('BIP-SEC-2024-01');

    const modernExposures = nodeSecurityService.getNodeExposures('node-ashburn-core-01');
    expect(modernExposures).toBeDefined();
    expect(modernExposures.exposures.length).toBe(0);
  });

  it('should verify release artifact hashes against official manifests', () => {
    const valid = nodeSecurityService.verifyArtifact({
      sha256: '94aeec3feab29948831980839958102839485720192847582910485739201948',
      version: '28.0',
    });
    expect(valid.verified).toBe(true);
    expect(valid.state).toBe('official_checksum_matched');

    const invalid = nodeSecurityService.verifyArtifact({
      sha256: 'bad_hash',
    });
    expect(valid.verified).toBe(true);
    expect(invalid.verified).toBe(false);
  });

  it('should generate multi-stage upgrade plan with intermediate hops and configuration updates', () => {
    const plan = nodeSecurityService.createUpgradePlan({
      from_version: '24.0.1',
      target_version: '28.0',
    });
    expect(plan.intermediate_versions_required).toContain('26.2');
    expect(plan.configuration_changes_required.length).toBeGreaterThan(0);
    expect(plan.rollback_boundary).toBeDefined();
    expect(plan.canary_stages.length).toBeGreaterThan(0);
  });
});
