jest.mock('../../../database', () => ({ __esModule: true, default: { query: jest.fn() } }));
// Exclude unrelated block/index initialization from the SQL projection regression.
jest.mock('../../../api/common', () => ({ Common: {} }));
jest.mock('../../../api/pools-parser', () => ({ __esModule: true, default: {} }));

import { readFileSync } from 'fs';
import { join } from 'path';
import config from '../../../config';
import DB from '../../../database';
import { knowledgeRegistryService } from './knowledge-registry.service';
import { developerIdentity, AuthenticatedOwner } from '../identity/developer-identity';
import { MemoryOwnerStore, useOwnerStore } from '../identity/owner-store';

const defaultPoolReader = knowledgeRegistryService.poolReader;

/**
 * Pool labels come from a pools definition fixture; submitted labels come
 * from an authenticated owner and are never reported as verified by this
 * service. Nothing is seeded.
 */
describe('knowledge registry: evidence is what the sources actually hold', () => {
  let owner: AuthenticatedOwner;

  beforeEach(async () => {
    useOwnerStore(new MemoryOwnerStore());
    developerIdentity.resetForTests();
    knowledgeRegistryService.resetForTests();
    knowledgeRegistryService.poolReader = async () => [
      { uniqueId: 1, name: 'Example Pool', slug: 'example', link: 'https://pool.example.org', regexes: '["/ExamplePool/"]', addresses: '["tb1qexamplepayout"]' },
      { uniqueId: 0, name: 'Unknown', slug: 'unknown', link: '', regexes: '[]', addresses: '[]' },
      { uniqueId: 2, name: 'Bare', slug: 'bare', link: '', regexes: '[]', addresses: '[]' },
    ];
    const key = await developerIdentity.bootstrapOwner('curator', '203.0.113.1');
    owner = (await developerIdentity.authenticateKey(key.secret_key))!;
  });

  it('no exchange labels exist unless someone submitted them', async () => {
    expect(await knowledgeRegistryService.getLabels('exchange')).toEqual([]);
    expect(await knowledgeRegistryService.getAuditLog()).toEqual([]);
  });

  it('pool labels carry the coinbase tags and payout addresses of the definition as evidence', async () => {
    const pools = await knowledgeRegistryService.getLabels('mining_pool');
    expect(pools.map(p => p.label_id).sort()).toEqual(['pool-1', 'pool-2']);
    const example = pools.find(p => p.label_id === 'pool-1')!;
    expect(example).toMatchObject({ source: 'pools_definition', status: 'verified', confidence_level: 2, category: 'mining_pool' });
    expect(example.evidence.map(e => e.evidence_type)).toEqual(['coinbase_tag', 'payout_address']);
    expect(example.evidence[1].description).toContain('tb1qexamplepayout');
    expect(pools.find(p => p.label_id === 'pool-2')).toMatchObject({ status: 'provisional', confidence_level: 1 });
    expect(await knowledgeRegistryService.getLabelByEntity('pool-example')).toMatchObject({ label_id: 'pool-1', name: 'Example Pool' });
  });

  it('rejects submissions without evidence or with unknown enums', async () => {
    await expect(knowledgeRegistryService.submitLabel(owner, 'address', 'tb1qtest12345', 'Guessed', 'custodian', [])).rejects.toMatchObject({ code: 'invalid_evidence', status: 400 });
    await expect(knowledgeRegistryService.submitLabel(owner, 'wallet', 'x', 'n', 'custodian', [{}])).rejects.toMatchObject({ code: 'invalid_entity_type' });
    await expect(knowledgeRegistryService.submitLabel(owner, 'address', 'x', 'n', 'bank', [{}])).rejects.toMatchObject({ code: 'invalid_category' });
    await expect(knowledgeRegistryService.submitLabel(owner, 'address', 'x', 'n', 'custodian', [{ evidence_type: 'rumour', reference_uri: 'u', description: 'd' }])).rejects.toMatchObject({ code: 'invalid_evidence_type' });
  });

  it('a submission with a proof string is still provisional, persisted, audited and challengeable', async () => {
    const label = await knowledgeRegistryService.submitLabel(owner, 'address', 'tb1qcustodian', 'Some Custodian', 'custodian', [
      { evidence_type: 'bip322_signature', reference_uri: 'https://example.org/attestation', cryptographic_proof: 'AUHs...', description: 'Signed attestation published by the operator' },
    ]);
    expect(label).toMatchObject({ status: 'provisional', confidence_level: 1, source: 'submitted', submitted_by: owner.owner_id });
    expect(label.evidence[0].verified_at_utc).toBeNull();
    expect(await knowledgeRegistryService.getLabelByEntity('tb1qcustodian')).toMatchObject({ label_id: label.label_id });
    expect((await knowledgeRegistryService.getLabels('custodian')).map(l => l.label_id)).toEqual([label.label_id]);
    expect(await knowledgeRegistryService.challengeLabel(owner, label.label_id, 'Attestation does not match the address', 'https://example.org/counter')).toBe(true);
    expect(await knowledgeRegistryService.challengeLabel(owner, 'missing', 'x', undefined)).toBe(false);
    expect((await knowledgeRegistryService.getLabelByEntity('tb1qcustodian'))).toMatchObject({ status: 'contested', dispute_reason: 'Attestation does not match the address' });
    const log = await knowledgeRegistryService.getAuditLog();
    expect(log.map(entry => entry.action)).toEqual(['challenged', 'created']);
    expect(log.every(entry => entry.actor_id === owner.owner_id)).toBe(true);
  });
});

describe('Knowledge native definition citation projection', () => {
  const enabled = config.DATABASE.ENABLED;
  afterEach(() => { config.DATABASE.ENABLED = enabled; knowledgeRegistryService.resetForTests(); jest.clearAllMocks(); });
  it('preserves real tracked citations and genuinely uncited definitions through the production SQL reader', async () => {
    const definitions = JSON.parse(readFileSync(join(__dirname, '../../../tasks/pools/pools-v2.json'), 'utf8'));
    const cited = definitions.find((pool: any) => pool.link && (pool.tags?.length || pool.addresses?.length));
    const uncited = definitions.find((pool: any) => !pool.link && (pool.tags?.length || pool.addresses?.length));
    expect(cited).toBeDefined(); expect(uncited).toBeDefined();
    const rows = [cited, uncited].map(pool => ({ uniqueId: pool.id, name: pool.name, link: pool.link || '', slug: pool.name.replace(/[^a-z0-9]/gi, '').toLowerCase(), addresses: JSON.stringify(pool.addresses || []), regexes: JSON.stringify(pool.tags || []) }));
    // The controlled driver returns only the projected columns, as native SQL does.
    (DB.query as jest.Mock).mockImplementation(async (sql: string) => [rows.map(row => sql.split(/\bFROM\b/i)[0].includes('link') ? row : (({ link: _link, ...rest }) => rest)(row))]);
    config.DATABASE.ENABLED = true; useOwnerStore(new MemoryOwnerStore());
    knowledgeRegistryService.resetForTests(); knowledgeRegistryService.poolReader = defaultPoolReader;
    const labels = await knowledgeRegistryService.getLabels('mining_pool');
    const known = labels.find(label => label.name === cited.name)!;
    expect(known.evidence.length).toBeGreaterThan(0);
    expect(known.evidence.every(item => item.reference_uri === cited.link && item.verified_at_utc === null)).toBe(true);
    expect(labels.find(label => label.name === uncited.name)!.evidence.every(item => item.reference_uri === '')).toBe(true);
    expect(DB.query).toHaveBeenCalledWith('SELECT unique_id AS uniqueId, name, link, addresses, regexes, slug FROM pools');
  });

  it('preserves both published identities when distinct names normalize to the same slug', async () => {
    knowledgeRegistryService.poolReader = async () => [
      { uniqueId: 81, name: 'Bitcoin India', slug: 'bitcoinindia', link: 'https://bitcoin-india.org', regexes: '["/Bitcoin-India/"]', addresses: '[]' },
      { uniqueId: 135, name: 'BitcoinIndia', slug: 'bitcoinindia', link: 'https://pool.bitcoin-india.org', regexes: '["/BitcoinIndia/"]', addresses: '[]' },
    ];
    const labels = await knowledgeRegistryService.getLabels();
    expect(labels.map(x => x.label_id)).toEqual(['pool-81', 'pool-135']);
    expect(labels.map(x => x.entity_id)).toEqual(['pool-81', 'pool-135']);
    expect((await knowledgeRegistryService.getLabelByEntity('pool-135'))?.evidence[0].reference_uri).toBe('https://pool.bitcoin-india.org');
  });

  it('refuses an ambiguous legacy slug alias rather than returning the first source row', async () => {
    knowledgeRegistryService.poolReader = async () => [
      { uniqueId: 81, name: 'Bitcoin India', slug: 'bitcoinindia', link: '', regexes: '[]', addresses: '[]' },
      { uniqueId: 135, name: 'BitcoinIndia', slug: 'bitcoinindia', link: '', regexes: '[]', addresses: '[]' },
    ];
    await expect(knowledgeRegistryService.getLabelByEntity('pool-bitcoinindia')).rejects.toMatchObject({ code: 'pool_alias_ambiguous', status: 409 });
  });

  it.each([0, -1, 1.5, NaN, '81', undefined])('refuses invalid published identity %s', async uniqueId => {
    knowledgeRegistryService.poolReader = async () => [{ uniqueId: uniqueId as number, name: 'Pool', slug: 'pool', link: '', regexes: '[]', addresses: '[]' }];
    await expect(knowledgeRegistryService.getLabels()).rejects.toMatchObject({ code: 'pool_source_identity_invalid', status: 503 });
  });

  it('refuses duplicate published IDs and keeps identity stable across source renames', async () => {
    const row = { uniqueId: 81, name: 'Before', slug: 'before', link: '', regexes: '[]', addresses: '[]' };
    knowledgeRegistryService.poolReader = async () => [row, { ...row, name: 'Other', slug: 'other' }];
    await expect(knowledgeRegistryService.getLabels()).rejects.toMatchObject({ code: 'pool_source_identity_invalid', status: 503 });
    knowledgeRegistryService.poolReader = async () => [row];
    expect(await knowledgeRegistryService.getLabelByEntity('pool-before')).toMatchObject({ entity_id: 'pool-81' });
    knowledgeRegistryService.resetForTests();
    knowledgeRegistryService.poolReader = async () => [{ ...row, name: 'After', slug: 'after' }];
    expect(await knowledgeRegistryService.getLabelByEntity('pool-81')).toMatchObject({ name: 'After', label_id: 'pool-81' });
    expect(await knowledgeRegistryService.getLabelByEntity('pool-after')).toMatchObject({ entity_id: 'pool-81' });
  });

  it('does not silently discard malformed source identities with absent slug metadata', async () => {
    knowledgeRegistryService.poolReader = async () => [{ uniqueId: 0, name: 'Malformed', slug: '', link: '', regexes: '[]', addresses: '[]' }];
    await expect(knowledgeRegistryService.getLabels()).rejects.toMatchObject({ code: 'pool_source_identity_invalid', status: 503 });
  });
  it('does not read SQL definitions when database support is disabled', async () => {
    config.DATABASE.ENABLED = false;
    expect(await defaultPoolReader()).toEqual([]);
    expect(DB.query).not.toHaveBeenCalled();
  });
});
