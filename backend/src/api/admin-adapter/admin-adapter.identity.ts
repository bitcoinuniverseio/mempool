import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import type {
  AdminEnvelope,
  AdminEnvironment,
  AdminNetwork,
  AdminReleaseIdentity,
} from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import config from '../../config';
import backendInfo from '../backend-info';

const {
  ADMIN_CONTROL_CONTRACT_VERSION,
  ADMIN_CONTROL_SCHEMA_VERSION,
  ADMIN_ENVIRONMENTS,
  ADMIN_NETWORKS,
} = adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

const RELEASE_SHA = /^[0-9a-f]{40}$/;

/**
 * Everything the Control Center needs to know about which build it is talking
 * to. All of it comes from what this process can actually prove: the commit
 * hash written at build time, the configured network, and the environment the
 * operator declared. Nothing here guesses.
 */

/** Exact ISO-8601 with milliseconds, which is what the contract requires. */
export function adminTimestamp(value?: Date | string | number | null): string {
  if (value === null || value === undefined) {
    return new Date().toISOString();
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function optionalAdminTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function releaseShaOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase();
  return RELEASE_SHA.test(text) ? text : null;
}

/**
 * A process that cannot prove it is production is never labelled production.
 */
export function explorerEnvironment(): AdminEnvironment {
  const declared = String(process.env.UNIVERSE_ADMIN_ENVIRONMENT ?? '').trim().toLowerCase();
  if ((ADMIN_ENVIRONMENTS as readonly string[]).includes(declared)) {
    return declared as AdminEnvironment;
  }
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

/** The Explorer names networks its own way; the contract names them one way. */
export function explorerNetwork(): AdminNetwork | null {
  const network = String(config.MEMPOOL.NETWORK ?? 'mainnet').trim().toLowerCase();
  const mapped =
    network === 'mainnet' || network === ''
      ? 'bitcoin:mainnet'
      : network === 'testnet' || network === 'testnet4'
        ? 'bitcoin:testnet'
        : network === 'signet'
          ? 'bitcoin:signet'
          : network === 'regtest'
            ? 'bitcoin:regtest'
            : network;
  return (ADMIN_NETWORKS as readonly string[]).includes(mapped) ? (mapped as AdminNetwork) : null;
}

export function explorerRelease(): AdminReleaseIdentity {
  const info = backendInfo.getBackendInfo();
  const backendSha = releaseShaOrNull(info.gitCommit);
  return {
    sha: backendSha,
    version: info.version === '?' ? null : info.version,
    builtAt: optionalAdminTimestamp(process.env.UNIVERSE_RELEASE_BUILT_AT),
    // The served frontend is a separate artifact. The control plane compares
    // the two, so reporting a guess here would defeat the drift check.
    frontendSha: releaseShaOrNull(process.env.UNIVERSE_FRONTEND_RELEASE_SHA),
    backendSha,
    workerSha: null,
    adapterSha: backendSha,
    migrationVersion: String(process.env.UNIVERSE_MIGRATION_VERSION ?? '') || null,
    configSchemaVersion: String(process.env.UNIVERSE_CONFIG_SCHEMA_VERSION ?? '') || null,
    repository: 'bitcoinuniverseio/mempool',
    branch: String(process.env.UNIVERSE_RELEASE_BRANCH ?? '') || null,
  };
}

export function adminEnvelope(): AdminEnvelope {
  return {
    schemaVersion: ADMIN_CONTROL_SCHEMA_VERSION,
    contractVersion: ADMIN_CONTROL_CONTRACT_VERSION,
    application: 'explorer',
    environment: explorerEnvironment(),
    generatedAt: adminTimestamp(),
  };
}
