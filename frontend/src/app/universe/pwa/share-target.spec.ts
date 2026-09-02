import { describe, expect, it } from 'vitest';

import { routeForSharedValue, ShareContext } from './share-target';

const CONTEXT: ShareContext = {
  origin: 'https://explorer.example',
  network: 'mainnet',
  maximumHeight: 9_000_000,
};

describe('routeForSharedValue', () => {
  it('reopens a page of this explorer from its link, query included', () => {
    const target = routeForSharedValue(null, 'https://explorer.example/tx/abc123?mode=full', CONTEXT);
    expect(target).toEqual({ kind: 'route', path: '/tx/abc123?mode=full', label: 'page' });
  });

  it('opens the home page from the bare origin', () => {
    const target = routeForSharedValue(null, 'https://explorer.example/', CONTEXT);
    expect(target).toEqual({ kind: 'route', path: '/', label: 'home' });
  });

  it('refuses a foreign link rather than opening something else', () => {
    const target = routeForSharedValue(null, 'https://elsewhere.example/tx/abc123', CONTEXT);
    expect(target).toEqual({ kind: 'unrecognized', value: '' });
  });

  it('sends a pasted link in the text field to the same page', () => {
    const target = routeForSharedValue('https://explorer.example/block/00000000000000000001', null, CONTEXT);
    expect(target).toEqual({ kind: 'route', path: '/block/00000000000000000001', label: 'page' });
  });

  it('opens an outpoint', () => {
    const txid = 'a'.repeat(64);
    const target = routeForSharedValue(`${txid}:3`, null, CONTEXT);
    expect(target).toEqual({ kind: 'route', path: `/outpoint/${txid}/3`, label: 'outpoint' });
  });

  it('opens an address', () => {
    const target = routeForSharedValue('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', null, CONTEXT);
    expect(target).toEqual({
      kind: 'route',
      path: '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
      label: 'address',
    });
  });

  it('leaves a 64 character hash unresolved, because it could be a block or a transaction', () => {
    const hash = 'c'.repeat(64);
    expect(routeForSharedValue(hash, null, CONTEXT)).toEqual({ kind: 'ambiguous-hash', value: hash });
  });

  it('lowers a hash before handing it on', () => {
    const upper = 'D'.repeat(64);
    expect(routeForSharedValue(upper, null, CONTEXT)).toEqual({
      kind: 'ambiguous-hash',
      value: 'd'.repeat(64),
    });
  });

  it('opens a plausible block height', () => {
    expect(routeForSharedValue('800000', null, CONTEXT)).toEqual({
      kind: 'route',
      path: '/block/800000',
      label: 'block height',
    });
  });

  it('refuses a number no block height can be', () => {
    expect(routeForSharedValue('9999999999', null, CONTEXT).kind).toBe('unrecognized');
  });

  it('states what it received when it is nothing it knows', () => {
    const target = routeForSharedValue('hello world', null, CONTEXT);
    expect(target).toEqual({ kind: 'unrecognized', value: 'hello world' });
  });

  it('treats an empty share as unrecognized, not as a route', () => {
    expect(routeForSharedValue('   ', null, CONTEXT)).toEqual({ kind: 'unrecognized', value: '' });
  });
});
