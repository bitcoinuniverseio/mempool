jest.mock('../../../repositories/PoolsRepository', () => ({ __esModule: true, default: { $getPools: jest.fn(async () => []) } }));

import { knowledgeRegistryService } from './knowledge-registry.service';
import { developerIdentity, AuthenticatedOwner } from '../identity/developer-identity';
import { MemoryOwnerStore, useOwnerStore } from '../identity/owner-store';

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
      { name: 'Example Pool', slug: 'example', link: 'https://pool.example.org', regexes: '["/ExamplePool/"]', addresses: '["tb1qexamplepayout"]' },
      { name: 'Unknown', slug: 'unknown', link: '', regexes: '[]', addresses: '[]' },
      { name: 'Bare', slug: 'bare', link: '', regexes: '[]', addresses: '[]' },
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
    expect(pools.map(p => p.label_id).sort()).toEqual(['pool-bare', 'pool-example']);
    const example = pools.find(p => p.label_id === 'pool-example')!;
    expect(example).toMatchObject({ source: 'pools_definition', status: 'verified', confidence_level: 2, category: 'mining_pool' });
    expect(example.evidence.map(e => e.evidence_type)).toEqual(['coinbase_tag', 'payout_address']);
    expect(example.evidence[1].description).toContain('tb1qexamplepayout');
    expect(pools.find(p => p.label_id === 'pool-bare')).toMatchObject({ status: 'provisional', confidence_level: 1 });
    expect(await knowledgeRegistryService.getLabelByEntity('pool-example')).toMatchObject({ name: 'Example Pool' });
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
