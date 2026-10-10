import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { controlled } from './protocol-functional-fixture.mjs';
import { acceptanceContextsDigest } from './acceptance-contexts.mjs';
import { releaseGate, projectProtocolFunctionalAcceptance, stageAcceptance } from './protocol-contract.mjs';
import { emitQualifiedFunctionalProjection, stageQualifiedApplicationClosure } from './protocol-functional-projection.mjs';
import { qualifyArtifact } from './qualify-artifact.mjs';
const encode = value => Buffer.from(JSON.stringify(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function mixed() {
  const f = controlled(), candidate = f.envelope.candidate;
  const put = (path, value) => { const bytes = encode(value); mkdirSync(dirname(join(f.root, path)), { recursive: true }); writeFileSync(join(f.root, path), bytes); return { path, sha256: hash(bytes) }; };
  delete candidate.acceptanceNetwork; delete candidate.deploymentNetwork; delete candidate.configurationProof;
  candidate.contexts = [['btc-signet','bitcoin','signet'], ['btc-testnet','bitcoin','testnet'], ['doge-testnet','dogecoin','testnet'], ['zec-testnet','zcash','testnet'], ['fractal-testnet','fractal','testnet'], ['local','local','offline']].map(([id, chain, network]) => {
    const profileProof = put(`docs/profiles/${id}.json`, { schemaVersion: 'universe-acceptance-chain-profile-v1', kind: chain === 'local' ? 'local' : 'blockchain', chain, network, sourceSha: candidate.sourceSha, dependencyRevision: candidate.dependencyRevision, specificationRevision: candidate.specificationRevisions[0], ...(chain !== 'local' ? { genesisHash: '1'.repeat(64), nonGenesis: { heightAtomic: '1', blockHash: '2'.repeat(64) } } : {}), ...(network === 'signet' ? { signetChallengeHex: '51' } : {}) });
    return { id, chain, acceptanceNetwork: network, deploymentNetwork: chain === 'local' ? 'offline' : 'mainnet', acceptanceProfileDigest: profileProof.sha256, deploymentConfigurationDigest: '3'.repeat(64), justification: 'Controlled fixture only: governing test-context justification', profileProof, configurationProof: { chain, network: chain === 'local' ? 'offline' : 'mainnet', configurationDigest: '3'.repeat(64), sourceRevision: candidate.sourceSha, acceptanceProfileDigest: profileProof.sha256, assertions: ['controlled independent binding'], evidence: [{ path: 'docs/run.json', sha256: hash(readFileSync(join(f.root, 'docs/run.json'))) }] } };
  });
  candidate.operationContexts = f.envelope.rows.map((row, index) => ({ protocol: row.protocol, operation: row.operation, variant: row.variant, contextId: row.chain === 'bitcoin' ? index % 2 ? 'btc-signet' : 'btc-testnet' : candidate.contexts.find(c => c.chain === row.chain).id }));
  candidate.applicationContexts = f.roster.operations.map(op => ({ operationId: op.id, contextIds: ['local'] }));
  candidate.acceptanceContextsSha256 = acceptanceContextsDigest(candidate);
  candidate.contextBindingProof = put('docs/context-binding.json', { schemaVersion: 'universe-acceptance-context-binding-proof-v1', sourceSha: candidate.sourceSha, configurationDigest: candidate.configurationDigest, acceptanceContextsSha256: candidate.acceptanceContextsSha256, assertions: ['controlled full context/config commitment'] });
  f.envelope.schemaVersion = 'universe-explorer-acceptance-v2';
  f.envelope.evidenceCellSummary = { declared:f.envelope.rows.length, passed:f.envelope.rows.length,failed:0,blocked:0,notApplicable:0,notTested:0 };
  f.envelope.rows.forEach((row, i) => { const context = candidate.contexts.find(c => c.id === candidate.operationContexts[i].contextId); Object.assign(row, { network: context.acceptanceNetwork, contextId: context.id, acceptanceProfileDigest: context.acceptanceProfileDigest }); });
  const app = JSON.parse(f.expected.application.acceptanceBytes); app.schemaVersion = 'universe-application-acceptance-v2'; app.candidate = candidate;
  app.operations.forEach(op => op.files.forEach(file => { const receipt = JSON.parse(readFileSync(join(f.root, file.path))); receipt.schemaVersion = 'universe-functional-operation-receipt-v2'; receipt.candidateIdentitySha256 = hash(encode(candidate)); Object.assign(receipt.testContext, { contextId: 'local', acceptanceProfileDigest: candidate.contexts.find(c => c.id === 'local').acceptanceProfileDigest }); file.sha256 = put(file.path, receipt).sha256; }));
  f.expected.application.protocolBytes = encode(f.envelope); app.protocolAcceptanceSha256 = hash(f.expected.application.protocolBytes); f.expected.application.acceptanceBytes = encode(app);
  return f;
}
test('v2 full39/123 plus632 closure qualifies explicit mixed profiles without v1 coercion', () => {
  const f = mixed(); try { assert.deepEqual(releaseGate(f.manifest, f.expected).problems, []); const value = projectProtocolFunctionalAcceptance(f.manifest, f.expected); assert.ok(value); assert.equal(value.schemaVersion, 'universe-protocol-functional-acceptance-set-v2'); assert.equal(value.protocols.length, 39); assert.equal(value.protocols.reduce((n,p) => n+p.passed, 0), 123); assert.equal(value.applicationQualification.requiredCoverageCount, 632); assert.equal(value.acceptanceNetwork, undefined); assert.ok(value.protocols.some(p => p.contexts.length === 2)); } finally { rmSync(f.root, { recursive:true, force:true }); }
});
test('v2 rejects unsupported, duplicated, missing, profile and row assignment drift', () => {
  const changes = [f => f.envelope.candidate.contexts[2].acceptanceNetwork = 'signet', f => f.envelope.candidate.contexts.push(f.envelope.candidate.contexts[0]), f => f.envelope.candidate.operationContexts.pop(), f => f.envelope.candidate.operationContexts.push(f.envelope.candidate.operationContexts[0]), f => f.envelope.rows[0].contextId = 'btc-signet', f => f.envelope.rows[0].acceptanceProfileDigest = '4'.repeat(64), f => f.envelope.candidate.contexts[0].deploymentNetwork = 'testnet', f => f.envelope.candidate.contexts[0].profileProof.sha256 = '5'.repeat(64), f => rmSync(join(f.root,f.envelope.candidate.contexts[0].profileProof.path))];
  for (const change of changes) { const f = mixed(); try { change(f); assert(releaseGate(f.manifest, f.expected).problems.length > 0); assert.equal(projectProtocolFunctionalAcceptance(f.manifest, f.expected), null); } finally { rmSync(f.root, { recursive:true, force:true }); } }
});
test('v2 full closure is staged, sealed and independently qualified from packed bytes', async()=>{
  const f=mixed(),out=mkdtempSync(join(tmpdir(),'mixed-context-packed-'));
  try {
    writeFileSync(join(f.root,'docs/acceptance/qualified-release-evidence.json'),f.expected.application.protocolBytes);
    writeFileSync(join(f.root,'docs/acceptance/qualified-application-evidence.json'),f.expected.application.acceptanceBytes);
    const stage=join(out,'stage');mkdirSync(stage);
    assert.deepEqual(stageAcceptance({manifestPath:join(f.root,'docs/protocols/PROTOCOL-COVERAGE.json'),acceptancePath:join(f.root,'docs/acceptance/qualified-release-evidence.json'),acceptanceRoot:f.root,stageRoot:stage}).problems,[]);
    stageQualifiedApplicationClosure(f.root,stage,f.expected.artifactCommit);
    for(const name of ['protocol-contract.mjs','reconciled-release.mjs','reconciled-operations.mjs','required-application-roster.mjs','protocol-functional-projection.mjs','acceptance-contexts.mjs']){mkdirSync(join(stage,'scripts/universe'),{recursive:true});copyFileSync(new URL('./'+name,import.meta.url),join(stage,'scripts/universe',name));}
    const member=emitQualifiedFunctionalProjection(stage,{artifactCommit:f.expected.artifactCommit,network:'mainnet'});
    writeFileSync(join(stage,'RELEASE-MANIFEST.json'),encode({schemaVersion:'universe-release-manifest-v1',commit:f.expected.artifactCommit,functionalAcceptanceProjection:member}));
    const archive=join(out,'mixed.tar.gz'),packed=spawnSync('tar',['-czf','mixed.tar.gz','-C',stage,'.'],{encoding:'utf8',cwd:out});assert.equal(packed.status,0,packed.stderr);
    const result=await qualifyArtifact(archive,{commit:f.expected.artifactCommit,network:'mainnet'});assert.deepEqual(result,[]);
    writeFileSync(join(stage,'docs/profiles/btc-signet.json'),'{}');
    assert.equal(spawnSync('tar',['-czf','mixed.tar.gz','-C',stage,'.'],{cwd:out}).status,0);assert((await qualifyArtifact(archive,{commit:f.expected.artifactCommit,network:'mainnet'})).length>0);
  } finally {rmSync(f.root,{recursive:true,force:true});rmSync(out,{recursive:true,force:true});}
});
test('application receipt-only context selection and source-only evidence never qualifies v2',()=>{
  for(const change of [r=>r.testContext.contextId='btc-signet',r=>r.testContext.acceptanceProfileDigest='4'.repeat(64),r=>r.schemaVersion='source-component-pass']){
    const f=mixed();try{const app=JSON.parse(f.expected.application.acceptanceBytes),file=app.operations[0].files[0],receipt=JSON.parse(readFileSync(join(f.root,file.path)));change(receipt);const bytes=encode(receipt);writeFileSync(join(f.root,file.path),bytes);file.sha256=hash(bytes);f.expected.application.acceptanceBytes=encode(app);assert.deepEqual(releaseGate(f.manifest,f.expected).problems,[]);assert.equal(projectProtocolFunctionalAcceptance(f.manifest,f.expected),null);}finally{rmSync(f.root,{recursive:true,force:true});}
  }
});

function rebind(f, app = JSON.parse(f.expected.application.acceptanceBytes)) {
  const candidate=f.envelope.candidate;candidate.acceptanceContextsSha256=acceptanceContextsDigest(candidate);
  const proof=encode({schemaVersion:'universe-acceptance-context-binding-proof-v1',sourceSha:candidate.sourceSha,configurationDigest:candidate.configurationDigest,acceptanceContextsSha256:candidate.acceptanceContextsSha256,assertions:['controlled full context/config commitment']});writeFileSync(join(f.root,candidate.contextBindingProof.path),proof);candidate.contextBindingProof.sha256=hash(proof);
  app.candidate=candidate;f.expected.application.rosterBytes=encode(f.roster);app.rosterSha256=hash(f.expected.application.rosterBytes);f.expected.application.protocolBytes=encode(f.envelope);app.protocolAcceptanceSha256=hash(f.expected.application.protocolBytes);
  for(const row of app.operations)for(const file of row.files){const receipt=JSON.parse(readFileSync(join(f.root,file.path)));receipt.candidateIdentitySha256=hash(encode(candidate));const bytes=encode(receipt);writeFileSync(join(f.root,file.path),bytes);file.sha256=hash(bytes);}
  f.expected.application.acceptanceBytes=encode(app);return app;
}
test('every explicitly assigned application profile needs its own full receipt and assertions',()=>{
  const f=mixed();try{
    const operation=f.roster.operations[0];operation.chain='bitcoin';operation.network='mainnet';f.envelope.candidate.applicationContexts[0].contextIds=['btc-signet','btc-testnet'];
    const app=JSON.parse(f.expected.application.acceptanceBytes),first=app.operations[0],base=JSON.parse(readFileSync(join(f.root,first.files[0].path)));first.files=[];
    for(const contextId of ['btc-signet','btc-testnet']){const context=f.envelope.candidate.contexts.find(c=>c.id===contextId),receipt={...base,operation,testContext:{chain:context.chain,network:context.acceptanceNetwork,contextId,acceptanceProfileDigest:context.acceptanceProfileDigest,justification:'controlled justified profile'}},path=`docs/receipts/multiple-${contextId}.json`;writeFileSync(join(f.root,path),encode(receipt));first.files.push({path,sha256:hash(encode(receipt))});}
    rebind(f,app);assert.ok(projectProtocolFunctionalAcceptance(f.manifest,f.expected));
    const complete=JSON.parse(f.expected.application.acceptanceBytes);const missing=structuredClone(complete);missing.operations[0].files.pop();f.expected.application.acceptanceBytes=encode(missing);assert.equal(projectProtocolFunctionalAcceptance(f.manifest,f.expected),null);
    f.expected.application.acceptanceBytes=encode(complete);const extra=structuredClone(complete),unassigned=JSON.parse(readFileSync(join(f.root,extra.operations[0].files[0].path))),local=f.envelope.candidate.contexts.find(c=>c.id==='local');unassigned.testContext={chain:'local',network:'offline',contextId:'local',acceptanceProfileDigest:local.acceptanceProfileDigest,justification:'controlled unassigned profile'};const unassignedBytes=encode(unassigned),unassignedPath='docs/receipts/unassigned-local.json';writeFileSync(join(f.root,unassignedPath),unassignedBytes);extra.operations[0].files.push({path:unassignedPath,sha256:hash(unassignedBytes)});f.expected.application.acceptanceBytes=encode(extra);assert.equal(projectProtocolFunctionalAcceptance(f.manifest,f.expected),null);
    const file=complete.operations[0].files[1],receipt=JSON.parse(readFileSync(join(f.root,file.path)));receipt.assertions=[];const bytes=encode(receipt);writeFileSync(join(f.root,file.path),bytes);file.sha256=hash(bytes);f.expected.application.acceptanceBytes=encode(complete);assert.equal(projectProtocolFunctionalAcceptance(f.manifest,f.expected),null);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('expanded variants retain123 declared operations and count124 evidence cells separately',()=>{
  const f=mixed();try{const original=f.envelope.rows[0],protocol=f.manifest.protocols.find(p=>p.id===original.protocol),descriptor=protocol.readOperationDescriptors.find(op=>op.id===original.operation);descriptor.requiredVariants=['default','controlled-extra'];const row={...original,variant:'controlled-extra'};f.envelope.rows.push(row);f.envelope.candidate.operationContexts.push({protocol:row.protocol,operation:row.operation,variant:row.variant,contextId:row.contextId});f.envelope.evidenceCellSummary.declared++;f.envelope.evidenceCellSummary.passed++;rebind(f);assert.deepEqual(releaseGate(f.manifest,f.expected).problems,[]);const value=projectProtocolFunctionalAcceptance(f.manifest,f.expected);assert.ok(value);assert.equal(value.declaredOperations,123);assert.equal(value.declaredOperationVariants,124);assert.equal(value.evidenceCells,124);f.envelope.rows.pop();assert.equal(projectProtocolFunctionalAcceptance(f.manifest,f.expected),null);}finally{rmSync(f.root,{recursive:true,force:true});}
});
test('rehashing cannot admit wrong-chain same-name, Mainnet or local protocol substitution',()=>{
  for(const change of [f=>{f.envelope.candidate.operationContexts[0].contextId='doge-testnet';f.envelope.rows[0].contextId='doge-testnet';f.envelope.rows[0].network='testnet';},f=>f.envelope.candidate.contexts[0].acceptanceNetwork='mainnet',f=>f.envelope.candidate.operationContexts[0].contextId='local']){
    const f=mixed();try{change(f);rebind(f);assert(releaseGate(f.manifest,f.expected).problems.length>0);assert.equal(projectProtocolFunctionalAcceptance(f.manifest,f.expected),null);}finally{rmSync(f.root,{recursive:true,force:true});}
  }
});
