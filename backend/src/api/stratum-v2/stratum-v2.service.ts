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
