import { createHash, createHmac, randomBytes } from 'crypto';
import adminControl from '@bitcoinuniverse/ecosystem-contracts/admin-control';
import {
  AdminAdapterNonceStore,
  isPrivateRemoteAddress,
  parseAdminAdapterKeys,
  verifyAdminAdapterRequest,
} from '../api/admin-adapter/admin-adapter.security';
import {
  ALLOWED_INDEXER_TASKS,
  DEPLOYMENT_CONTROLLED_OPERATIONS,
  DEPLOYMENT_CONTROL_REASON,
  deploymentControlConfigured,
  explorerOperationDefinitions,
  findExplorerOperationDefinition,
} from '../api/admin-adapter/admin-adapter.catalog';

const {
  ADMIN_SERVICE_HEADERS,
  ADMIN_CONTROL_CONTRACT_VERSION,
  ADMIN_RISK_LEVELS,
  ADMIN_PERMISSIONS,
  ADMIN_RESOURCE_KINDS,
  adminRiskRequiresElevation,
  adminServiceSigningString,
} = adminControl as typeof import('@bitcoinuniverse/ecosystem-contracts/admin-control');

const SECRET = randomBytes(32);
const KEY_ID = 'control-center';
const KEYS = [{ keyId: KEY_ID, secret: SECRET }];

function signed(overrides: Record<string, any> = {}) {
  const rawBody = Buffer.from(JSON.stringify({ input: {} }), 'utf8');
  const bodyDigest = createHash('sha256').update(rawBody).digest('hex');
  const timestamp = new Date().toISOString();
  const nonce = randomBytes(12).toString('base64url');
  const method = overrides.method ?? 'POST';
  const originalUrl =
    overrides.originalUrl ?? '/internal/admin/v1/snapshot?network=bitcoin%3Amainnet';
  const [path, query = ''] = originalUrl.split('?');
  const signature = createHmac('sha256', SECRET)
    .update(
      adminServiceSigningString({
        method,
        path,
        query,
        keyId: KEY_ID,
        timestamp,
        nonce,
        bodyDigest,
      }),
    )
    .digest('hex');
  return {
    method,
    originalUrl,
    rawBody,
    remoteAddress: '127.0.0.1',
    keys: KEYS,
    nonceStore: new AdminAdapterNonceStore(),
    headers: {
      [ADMIN_SERVICE_HEADERS.keyId]: KEY_ID,
      [ADMIN_SERVICE_HEADERS.timestamp]: timestamp,
      [ADMIN_SERVICE_HEADERS.nonce]: nonce,
      [ADMIN_SERVICE_HEADERS.bodyDigest]: bodyDigest,
      [ADMIN_SERVICE_HEADERS.signature]: signature,
      [ADMIN_SERVICE_HEADERS.contractVersion]: ADMIN_CONTROL_CONTRACT_VERSION,
      ...(overrides.headers ?? {}),
    },
    ...overrides,
  };
}

describe('parseAdminAdapterKeys', () => {
  it('accepts a well formed key pair', () => {
    const keys = parseAdminAdapterKeys(`${KEY_ID}:${SECRET.toString('base64')}`);
    expect(keys).toHaveLength(1);
    expect(keys[0].secret.equals(SECRET)).toBe(true);
  });

  it('accepts two keys so a rotation has an overlap window', () => {
    const keys = parseAdminAdapterKeys(
      `${KEY_ID}:${SECRET.toString('base64')}, next:${randomBytes(32).toString('base64')}`,
    );
    expect(keys.map((key) => key.keyId)).toEqual([KEY_ID, 'next']);
  });

  it('refuses a secret too short to be a key, and malformed entries', () => {
    expect(parseAdminAdapterKeys(`${KEY_ID}:${randomBytes(8).toString('base64')}`)).toHaveLength(0);
    expect(parseAdminAdapterKeys('nokeyid')).toHaveLength(0);
    expect(parseAdminAdapterKeys(undefined)).toHaveLength(0);
  });
});

describe('isPrivateRemoteAddress', () => {
  it('accepts loopback and private ranges', () => {
    for (const address of [
      '127.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.10',
      'fd00::1',
    ]) {
      expect(isPrivateRemoteAddress(address)).toBe(true);
    }
  });

  it('refuses public addresses and anything it cannot read', () => {
    for (const address of ['8.8.8.8', '172.32.0.1', '2001:4860::1', '', 'nonsense']) {
      expect(isPrivateRemoteAddress(address)).toBe(false);
    }
  });
});

describe('verifyAdminAdapterRequest', () => {
  it('accepts a correctly signed request from a private address', () => {
    expect(verifyAdminAdapterRequest(signed()).ok).toBe(true);
  });

  it('answers a public request with 404 so a scan does not learn the routes exist', () => {
    const verdict = verifyAdminAdapterRequest(signed({ remoteAddress: '8.8.8.8' }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.status).toBe(404);
  });

  it('refuses to serve at all when no key is configured', () => {
    const verdict = verifyAdminAdapterRequest(signed({ keys: [] }));
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.status).toBe(503);
  });

  it('refuses an unsupported contract version with an explicit reason', () => {
    const request = signed();
    request.headers[ADMIN_SERVICE_HEADERS.contractVersion] = '9.9.9';
    const verdict = verifyAdminAdapterRequest(request);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.status).toBe(403);
    expect(verdict.ok === false && verdict.message).toContain('9.9.9');
  });

  it('refuses a body that does not match its digest', () => {
    const request = signed();
    request.rawBody = Buffer.from('{"input":{"tampered":true}}', 'utf8');
    expect(verifyAdminAdapterRequest(request).ok).toBe(false);
  });

  it('refuses a query changed after signing', () => {
    const request = signed();
    request.originalUrl = '/internal/admin/v1/snapshot?network=bitcoin%3Atestnet';
    expect(verifyAdminAdapterRequest(request).ok).toBe(false);
  });

  it('refuses a signature made with a different key', () => {
    const request = signed({ keys: [{ keyId: KEY_ID, secret: randomBytes(32) }] });
    expect(verifyAdminAdapterRequest(request).ok).toBe(false);
  });

  it('refuses a stale timestamp', () => {
    const request = signed();
    request.headers[ADMIN_SERVICE_HEADERS.timestamp] = new Date(Date.now() - 600_000).toISOString();
    expect(verifyAdminAdapterRequest(request).ok).toBe(false);
  });

  it('refuses a replayed nonce even when everything else verifies', () => {
    const store = new AdminAdapterNonceStore();
    const request = signed({ nonceStore: store });
    expect(verifyAdminAdapterRequest(request).ok).toBe(true);
    expect(verifyAdminAdapterRequest(request).ok).toBe(false);
  });

  it('gives one message for every rejection so a caller learns nothing', () => {
    const tampered = signed();
    tampered.rawBody = Buffer.from('{}', 'utf8');
    const missing = signed();
    delete missing.headers[ADMIN_SERVICE_HEADERS.nonce];
    const messages = [tampered, missing].map((request) => {
      const verdict = verifyAdminAdapterRequest(request);
      return verdict.ok ? 'accepted' : verdict.message;
    });
    expect(new Set(messages).size).toBe(1);
  });
});

describe('Explorer operation catalog', () => {
  const operations = explorerOperationDefinitions({});

  it('is not empty and has unique ids under the explorer prefix', () => {
    expect(operations.length).toBeGreaterThan(0);
    const ids = operations.map((operation) => operation.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.startsWith('explorer.')).toBe(true);
    }
  });

  it('declares a known risk level, permission and resource kind for every operation', () => {
    for (const operation of operations) {
      expect(ADMIN_RISK_LEVELS).toContain(operation.risk);
      expect(ADMIN_PERMISSIONS).toContain(operation.requiredPermission);
      if (operation.resourceKind !== null) {
        expect(ADMIN_RESOURCE_KINDS).toContain(operation.resourceKind);
      }
      expect(operation.application).toBe('explorer');
    }
  });

  it('gives every operation a preview, a stated effect, a postcondition and a lock', () => {
    for (const operation of operations) {
      expect(operation.preview).toBe(true);
      expect(operation.sideEffects.length).toBeGreaterThan(0);
      expect(operation.postconditions.length).toBeGreaterThan(0);
      expect(operation.description.length).toBeGreaterThan(20);
      expect(typeof operation.lock).toBe('string');
      expect(operation.lock).not.toBe('');
    }
  });

  it('requires a typed confirmation and refuses retries above guarded', () => {
    for (const operation of operations) {
      if (!adminRiskRequiresElevation(operation.risk)) {
        continue;
      }
      expect(operation.inputFields.map((field) => field.name)).toContain('confirmation');
      expect(operation.retryPolicy).toBe('none');
    }
  });

  it('accepts no input that could carry a command, path, RPC method or unit name', () => {
    const forbidden = /(command|script|shell|sql|rpc|method|path|file|unit|url|endpoint|exec)/i;
    for (const operation of operations) {
      for (const field of operation.inputFields) {
        expect(field.name).not.toMatch(forbidden);
      }
    }
  });

  it('constrains the indexing task operation to the two tasks this Explorer defines', () => {
    const task = findExplorerOperationDefinition('explorer.indexer.task.run', {});
    const field = task.inputFields.find((entry) => entry.name === 'task');
    expect(field?.type).toBe('select');
    expect(field?.options).toEqual([...ALLOWED_INDEXER_TASKS]);
  });

  it('shows deployment-controlled operations as not configured with the exact reason', () => {
    for (const id of DEPLOYMENT_CONTROLLED_OPERATIONS) {
      const operation = findExplorerOperationDefinition(id, {});
      expect(operation.availability).toBe('not_configured');
      expect(operation.availabilityReason).toBe(DEPLOYMENT_CONTROL_REASON);
      expect(operation.availabilityReason).toContain('EXPLORER_DEPLOYMENT_CONTROL');
    }
  });

  it('enables the deployment-controlled operations only on the exact configured value', () => {
    expect(deploymentControlConfigured({})).toBe(false);
    expect(deploymentControlConfigured({ EXPLORER_DEPLOYMENT_CONTROL: 'true' })).toBe(false);
    expect(deploymentControlConfigured({ EXPLORER_DEPLOYMENT_CONTROL: 'enabled' })).toBe(true);
    const enabled = findExplorerOperationDefinition('explorer.service.restart', {
      EXPLORER_DEPLOYMENT_CONTROL: 'enabled',
    });
    expect(enabled.availability).toBe('enabled');
    expect(enabled.availabilityReason).toBeNull();
  });

  it('covers the Explorer subsystems the Control Center has to reach', () => {
    const ids = operations.map((operation) => operation.id);
    for (const expected of [
      'explorer.capabilities.refresh',
      'explorer.dependencies.recheck',
      'explorer.address-index.probe',
      'explorer.release.verify',
      'explorer.smoke.run',
      'explorer.pools.refresh',
      'explorer.prices.refresh',
      'explorer.indexer.task.run',
      'explorer.indexer.reindex',
      'explorer.runs.reconcile',
      'explorer.service.restart',
      'explorer.release.rollback',
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it('rejects an unknown operation id instead of falling through', () => {
    expect(() => findExplorerOperationDefinition('explorer.nope', {})).toThrow(/Unknown operation/);
  });
});
