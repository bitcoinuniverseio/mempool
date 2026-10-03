import {
  StratumV2JobDeclaration,
  StratumV2RoleStatus,
  StratumV2Template,
} from './stratum-v2.types';

/**
 * Raised when a read has no source behind it. The routes map the code to a
 * 503, so an absent integration is reported as an absent integration rather
 * than as an answer.
 */
export class StratumV2EvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503) {
    super(message);
  }
}

const rolesUnavailable =
  'Stratum V2 observations are unavailable. Role, template and job-declaration reads require the owned SV2 roles (template provider on the owned Bitcoin node and job declarator) with their telemetry export, which are not connected on this deployment.';

/**
 * Stratum V2 role, template and job-declaration evidence.
 *
 * Every read here needs owned SV2 roles that export their state. None is
 * connected, so each read reports the absent source. The revision this
 * replaces answered from constants: two roles marked active with invented
 * endpoints and uptimes, a template generated at request time, and a job
 * declaration accepted by a pool that had never seen it.
 */
export class StratumV2Service {
  /* IMPLEMENTATION-HANDOFF [WP-BE-011]
   * Defect BE-011; COV-BE-011 network roles, templates, job declarations.
   * All three offered reads always fail. They are not replaced by generic
   * getblocktemplate or the overlay routes. backend-reproduce.cjs verifies
   * the current source; frontend stratum-v2 requests all three operations.
   * 1. Pin the actually operated SV2 role software and negotiated specification
   *    revision using R-BE-SV2. Identify template provider, job declarator and
   *    pool endpoints plus authenticated telemetry transport. Mainnet Core
   *    RPC availability alone does not prove those separate roles exist.
   * 2. Add bounded read adapters for real role/session state, template IDs and
   *    declaration request/response evidence. Preserve the negotiated feature
   *    flags, channel/session identities, prevhash and source timestamps.
   * 3. Bind templates to the owned node checkpoint. Distinguish proposal,
   *    accepted declaration, rejection and stale work from actual messages;
   *    derive no accepted status from local construction or a role heartbeat.
   *    Persist required observation history/cursors with bounded retention.
   * 4. Implement source-to-stratum-v2 types/routes/frontend mappings, exact
   *    fee/amount fields and unavailable/stale states. Keep secrets and Noise
   *    session keys out of public telemetry; no new public mining controls.
   * 5. Exercise the actual roles on supported Signet or justified regtest:
   *    negotiation, template update, declaration accept/reject, new prevhash,
   *    source disconnect, replay, restart and dependent template regressions.
   * Acceptance: all three public read journeys show current sourced states;
   * fixtures alone or independently successful roles do not prove the joins.
   * Rollback: restore the compatible role/adapter versions and persisted
   * checkpoints; do not roll back unrelated mining configuration or jobs.
   * Preparation only; no role is configured or source behavior altered.
   */
  /** @asyncSafe */
  public async $getRoles(): Promise<StratumV2RoleStatus[]> {
    throw new StratumV2EvidenceError('unavailable-sv2-roles', rolesUnavailable);
  }

  /** @asyncSafe */
  public async $getTemplates(): Promise<StratumV2Template[]> {
    throw new StratumV2EvidenceError('unavailable-sv2-roles', rolesUnavailable);
  }

  /** @asyncSafe */
  public async $getDeclarations(): Promise<StratumV2JobDeclaration[]> {
    throw new StratumV2EvidenceError('unavailable-sv2-roles', rolesUnavailable);
  }
}

export const stratumV2Service = new StratumV2Service();
