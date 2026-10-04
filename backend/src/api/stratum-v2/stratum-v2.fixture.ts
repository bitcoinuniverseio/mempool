import { createHash } from 'crypto';
import { Sv2Snapshot } from './stratum-v2.native-types';
/** Controlled wire-contract observations, not native-role acceptance evidence. */
export function sv2Fixture(now = Date.now()): Sv2Snapshot {
  const hash = 'a'.repeat(64), stamp = new Date(now).toISOString(), headerHex = '00'.repeat(80);
  const blockHash = createHash('sha256').update(createHash('sha256').update(Buffer.from(headerHex, 'hex')).digest()).digest().reverse().toString('hex');
  const sourceEpoch = 'c57b28a6-1c96-4c19-a5e8-2d37f9987761';
  const roleIds = ['template-provider', 'pool-and-jds', 'job-declarator-client', 'translator'];
  const links = [0, 1, 2].map(index => {
    const logOffsetAtomic = String(index * 100 + 50), rawLineSha256 = String(index + 1).repeat(64);
    return { eventId: createHash('sha256').update(`${sourceEpoch}\n${hash}\n${logOffsetAtomic}\n${rawLineSha256}`).digest('hex'), sequenceAtomic: String(index), observedAt: stamp,
      logId: hash, logOffsetAtomic, rawLineSha256, requestIdAtomic: String(index), templateIdAtomic: '18446744073709551615', channelIdAtomic: '1', jobIdAtomic: '2',
      coinbaseValueRemainingSats: '5000000000', transactionCountAtomic: '0', prevHashLE: Buffer.from(blockHash, 'hex').reverse().toString('hex'),
      declarationSuccess: { observedAt: stamp, logOffsetAtomic: String(index * 100), rawLineSha256: hash }, acceptance: 'accepted' as const };
  });
  return { schema: 'universe-sv2-native-snapshot-v1', profile: { schema: 'universe-sv2-source-profile-v1', network: 'regtest', genesisHash: hash, blockOneHash: hash, signetChallenge: null,
    core: { software: 'controlled-Core', versionAtomic: '310000', sourceRevision: null, binarySha256: hash, configurationSha256: hash },
    roleSources: roleIds.map(roleId => ({ roleId, software: 'controlled-role', version: '0.8.0', sourceRevision: null, binarySha256: hash, configurationSha256: hash, derivative: null })) },
    profileSha256: hash, sourceEpoch, sourceGenerationAtomic: '1', observedAt: stamp,
    core: { genesisHash: hash, signetChallenge: null, checkpoint: { heightAtomic: '17', blockHash, headerHex }, initialBlockDownload: false, verifiedAt: stamp },
    roles: roleIds.map(roleId => ({ roleId, health: { status: 'unavailable', httpStatus: null, observedAt: null }, uptimeSecondsAtomic: null, connectedDownstreamsAtomic: null, globalCounters: null,
      transports: roleId === 'translator' ? [{ direction: 'downstream', peerRoleId: null, protocol: 'SV1', security: 'plaintext', evidence: 'configured', observedAt: null }] : [] })),
    links, retention: { scope: 'bounded-retained-native-links', maximumLinks: 512, retainedLinksAtomic: '3', droppedLinksAtomic: '0', firstSequenceAtomic: '0', lastSequenceAtomic: '2', completeHistory: false, gapReason: null } };
}
