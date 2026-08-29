import { describe, expect, it } from 'vitest';
import { ChainExplorerPayload } from '@app/universe/universe.types';
import {
  chainProfile,
  classifyPayload,
  readAddress,
} from '@app/universe/multichain-explorer/multichain-view';

/**
 * `/api/v1/zcash/address/<t-address>` as production returned it on
 * 2026-08-29, with the unspent output list and the history trimmed to two
 * entries each and nothing else changed.
 */
const ZCASH_ADDRESS = {
    "schemaVersion": "zcash-metaprotocols-api-v1",
    "network": "mainnet",
    "checkpoint": {
      "height": "3464734",
      "hash": "0000000000645e18fd55f18a5b2681f0becdc180d14d35a730875c4dc66add1a"
    },
    "coverage": {
      "scannedHeight": "3464734",
      "networkHeight": "3464734",
      "blocksBehindNetwork": "0",
      "nodeSynced": true,
      "verificationProgress": 0.9999997113775545,
      "chainComplete": true
    },
    "address": "t1SEgZvXCu3ceE42qrq5pCeSq7HbLjX8NJv",
    "address_type": "transparent",
    "publicly_observable": true,
    "balance": {
      "confirmed_zatoshis": "1251345400",
      "received_zatoshis": "920300177805"
    },
    "utxos": [
      {
        "txid": "e642bab049488871a307aff5a46be789b374858dfa7163e33ddff27c76e80438",
        "vout": 0,
        "valueZatoshis": "125522000",
        "scriptPubKey": "76a9145bbd8cad40c669b9ef2a5b7b2fbedbe9f74d7bea88ac"
      },
      {
        "txid": "44b60d006a4197f81385da1718eeddb5be23fdfdaa45553f0cae97766f2e150e",
        "vout": 0,
        "valueZatoshis": "125015000",
        "scriptPubKey": "76a9145bbd8cad40c669b9ef2a5b7b2fbedbe9f74d7bea88ac"
      }
    ],
    "transactions": {
      "total": "8945",
      "offset": "0",
      "limit": "50",
      "items": [
        "73c47124313064d13e53b921857de4d57ac45e3e712b97233a2b38092f39ffbf",
        "8dc93dfbc11a54d0a71488e6ba5193216018ef289a3e2f4ea8f115bab03011f6"
      ],
      "has_more": true
    },
    "privacy_notice": "This page covers only publicly observable transparent activity and does not reveal shielded or Unified Address history.",
    "chain": "zcash"
  } as unknown as ChainExplorerPayload;

const ZEC = chainProfile('zcash');

describe('a Zcash address, in the shape Zcash actually sends', () => {
  it('shows the balance, which was in the response and on no page', () => {
    // `balance.confirmed_zatoshis`, not `balanceAtomic`. Read against the
    // Dogecoin name the page rendered an address and no figures at all.
    const reading = readAddress(ZCASH_ADDRESS, ZEC);
    expect(reading?.balance).toEqual({ display: '12.513454', exact: '1251345400' });
    expect(reading?.totalReceived).toEqual({ display: '9,203.00177805', exact: '920300177805' });
  });

  it('does not derive a figure the chain did not state', () => {
    // Received minus confirmed is not what has been sent: it is wrong the
    // moment an output is unconfirmed or immature, and this source publishes
    // neither figure.
    const reading = readAddress(ZCASH_ADDRESS, ZEC);
    expect(reading?.totalSent).toBeNull();
    expect(reading?.unconfirmedBalance).toBeNull();
    expect(reading?.unconfirmedCount).toBeNull();
  });

  it('reads the history and its paging out of the envelope it arrives in', () => {
    const reading = readAddress(ZCASH_ADDRESS, ZEC);
    expect(reading?.transactionCount?.exact).toBe('8945');
    expect(reading?.txids).toHaveLength(2);
    expect(reading?.paging?.page).toBe(1);
    expect(reading?.paging?.nextPage).toBe(2);
  });

  it('reads an unspent output whose index is a number and whose amount is not called value', () => {
    const utxo = readAddress(ZCASH_ADDRESS, ZEC)?.utxos[0];
    expect(utxo?.vout).toBe('0');
    expect(utxo?.amount).toEqual({ display: '1.25522', exact: '125522000' });
    // Neither height nor confirmation count is in this payload.
    expect(utxo?.height).toBeNull();
    expect(utxo?.confirmations).toBeNull();
    // And that says nothing about whether the output is confirmed. Every
    // unspent output on this address is confirmed, and a missing height read
    // as "not in a block yet" labelled all of them pending.
    expect(utxo?.pending).toBe(false);
  });

  it('still reads the Dogecoin shape', () => {
    const dogecoin = {
      chain: 'dogecoin',
      address: 'DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L',
      balanceAtomic: '1284460000000',
      totalReceivedAtomic: '9930000000000',
      totalSentAtomic: '8645540000000',
      transactionCountAtomic: '318',
      utxos: [{ txid: 'a'.repeat(64), voutAtomic: '1', valueAtomic: '74886600000', heightAtomic: '5623038', confirmationsAtomic: '3' }],
    } as unknown as ChainExplorerPayload;
    expect(classifyPayload(dogecoin)).toBe('address');
    const reading = readAddress(dogecoin, chainProfile('dogecoin'));
    expect(reading?.balance?.exact).toBe('1284460000000');
    expect(reading?.totalSent?.exact).toBe('8645540000000');
    expect(reading?.utxos[0].vout).toBe('1');
    // This source does state a height, so an output without one is pending.
    expect(reading?.utxos[0].pending).toBe(false);
    const pendingUtxo = readAddress(
      { ...dogecoin, utxos: [{ txid: 'b'.repeat(64), voutAtomic: '0', valueAtomic: '5' }] } as unknown as ChainExplorerPayload,
      chainProfile('dogecoin')
    );
    expect(pendingUtxo?.utxos[0].pending).toBe(true);
  });
});
