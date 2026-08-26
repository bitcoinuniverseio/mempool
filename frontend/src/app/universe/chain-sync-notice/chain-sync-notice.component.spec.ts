import { describe, expect, it } from 'vitest';
import {
  CHAIN_SYNC_TOLERANCE_BLOCKS,
  chainSyncNotice,
} from '@app/universe/chain-sync-notice/chain-sync-notice.component';
import type { IBackendInfo } from '@interfaces/websocket.interface';

function info(patch: Record<string, unknown> = {}): IBackendInfo {
  return {
    gitCommit: 'abc1234',
    version: '3.3.1',
    chainSync: {
      blocks: 900000,
      headers: 900000,
      initialBlockDownload: false,
      verificationProgress: 1,
      checkedAt: '2026-08-26T00:00:00.000Z',
    },
    ...patch,
  } as IBackendInfo;
}

describe('chainSyncNotice', () => {
  it('says nothing when the node is at the tip', () => {
    expect(chainSyncNotice(info()).show).toBe(false);
  });

  it('says nothing while the backend has not reported yet', () => {
    expect(chainSyncNotice(null).show).toBe(false);
    expect(chainSyncNotice(info({ chainSync: null })).show).toBe(false);
    expect(chainSyncNotice(info({ chainSync: undefined })).show).toBe(false);
  });

  it('tolerates ordinary propagation lag', () => {
    const notice = chainSyncNotice(
      info({
        chainSync: {
          blocks: 900000,
          headers: 900000 + CHAIN_SYNC_TOLERANCE_BLOCKS,
          initialBlockDownload: false,
          verificationProgress: 1,
          checkedAt: '',
        },
      }),
    );
    expect(notice.show).toBe(false);
  });

  it('speaks up once the node is genuinely behind', () => {
    const notice = chainSyncNotice(
      info({
        chainSync: {
          blocks: 819435,
          headers: 964191,
          initialBlockDownload: true,
          verificationProgress: 0.663316,
          checkedAt: '',
        },
      }),
    );
    expect(notice.show).toBe(true);
    expect(notice.behind).toBe(964191 - 819435);
    expect(notice.percent).toBe(66);
    expect(notice.initial).toBe(true);
  });

  it('speaks up during initial block download even with no gap reported yet', () => {
    const notice = chainSyncNotice(
      info({
        chainSync: {
          blocks: 100,
          headers: 100,
          initialBlockDownload: true,
          verificationProgress: 0,
          checkedAt: '',
        },
      }),
    );
    expect(notice.show).toBe(true);
    expect(notice.behind).toBe(0);
  });

  it('never reports a negative gap or a percentage outside its range', () => {
    const notice = chainSyncNotice(
      info({
        chainSync: {
          blocks: 900005,
          headers: 900000,
          initialBlockDownload: true,
          verificationProgress: 1.4,
          checkedAt: '',
        },
      }),
    );
    expect(notice.behind).toBe(0);
    expect(notice.percent).toBe(100);
  });

  it('floors progress rather than rounding it up', () => {
    const notice = chainSyncNotice(
      info({
        chainSync: {
          blocks: 1,
          headers: 100,
          initialBlockDownload: true,
          verificationProgress: 0.999,
          checkedAt: '',
        },
      }),
    );
    expect(notice.percent).toBe(99);
  });

  it('ignores a malformed reading rather than rendering nonsense', () => {
    const notice = chainSyncNotice(
      info({
        chainSync: {
          blocks: Number.NaN,
          headers: 100,
          initialBlockDownload: true,
          verificationProgress: 0.5,
          checkedAt: '',
        },
      }),
    );
    expect(notice.show).toBe(false);
  });
});
