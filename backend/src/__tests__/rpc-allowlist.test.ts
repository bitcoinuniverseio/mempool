import {
  ALLOWED_METHODS,
  allowlistIsClean,
  FORBIDDEN_METHODS,
  methodNamed,
  readArguments,
  redactNetworkInfo,
  redactPeerInfo,
  type AllowedMethod,
} from '../api/node-console/rpc-allowlist';

/**
 * These are the tests that matter most in this repository.
 *
 * Everything else here fails by showing a wrong number. This fails by making
 * a node method reachable that should never have been, so the assertions are
 * written to catch that specific thing rather than to exercise the happy
 * path.
 */

function method(name: string): AllowedMethod {
  const found = methodNamed(name);
  if (!found) { throw new Error(`${name} is expected to be on the allowlist`); }
  return found;
}

describe('the allowlist is an allowlist', () => {
  it('has no forbidden method on it', () => {
    expect(allowlistIsClean()).toBe(true);
  });

  it('refuses every forbidden name individually', () => {
    // Asserted one at a time as well as in aggregate, so a failure names the
    // method that got through rather than saying the list is dirty.
    for (const name of FORBIDDEN_METHODS) {
      expect(methodNamed(name)).toBeNull();
    }
  });

  it('refuses a method nobody has heard of', () => {
    expect(methodNamed('getthething')).toBeNull();
    expect(methodNamed('')).toBeNull();
  });

  it('refuses a name that is not a string', () => {
    // A JSON body can carry anything, and a lookup on an object or an array
    // must not reach the map at all.
    expect(methodNamed(undefined)).toBeNull();
    expect(methodNamed(null)).toBeNull();
    expect(methodNamed(42)).toBeNull();
    expect(methodNamed(['getblockcount'])).toBeNull();
    expect(methodNamed({ toString: () => 'getblockcount' })).toBeNull();
  });

  it('refuses a name that differs only in case or spacing', () => {
    expect(methodNamed('GetBlockCount')).toBeNull();
    expect(methodNamed(' getblockcount')).toBeNull();
    expect(methodNamed('getblockcount ')).toBeNull();
  });

  it('cannot be reached through a prototype key', () => {
    // A plain object used as a lookup table answers to these. A Map does not,
    // and this is the assertion that keeps it a Map.
    expect(methodNamed('__proto__')).toBeNull();
    expect(methodNamed('constructor')).toBeNull();
    expect(methodNamed('toString')).toBeNull();
    expect(methodNamed('hasOwnProperty')).toBeNull();
  });

  it('exposes nothing that broadcasts, signs, or controls the node', () => {
    const names = ALLOWED_METHODS.map((entry) => entry.name);
    const dangerous = /wallet|priv|sign|send|submit|generate|import|ban|stop|prune|invalidate|reconsider|setnetwork|addnode|disconnect|logging|mocktime|rescan/i;
    for (const name of names) {
      expect(name).not.toMatch(dangerous);
    }
  });

  it('exposes nothing whose cost is unbounded', () => {
    const names = ALLOWED_METHODS.map((entry) => entry.name);
    // Each of these walks the whole UTXO set or the whole mempool, and a
    // public route that can be made to do that is a way to stop the node.
    expect(names).not.toContain('gettxoutsetinfo');
    expect(names).not.toContain('scantxoutset');
    expect(names).not.toContain('scanblocks');
    expect(names).not.toContain('getrawmempool');
  });

  it('exposes nothing that describes this process rather than the chain', () => {
    const names = ALLOWED_METHODS.map((entry) => entry.name);
    // getrpcinfo names the log path and the commands in flight.
    expect(names).not.toContain('getrpcinfo');
    expect(names).not.toContain('getmemoryinfo');
  });

  it('gives every entry a summary, a category and a client method', () => {
    for (const entry of ALLOWED_METHODS) {
      expect(entry.summary.length).toBeGreaterThan(10);
      expect(entry.clientMethod.length).toBeGreaterThan(0);
      expect(['chain', 'mempool', 'network', 'mining', 'decode']).toContain(entry.category);
    }
  });

  it('names each entry once', () => {
    const names = ALLOWED_METHODS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('states why any trimmed answer is trimmed', () => {
    // A reader shown a field that says "removed" is owed the reason next to
    // it, not in a changelog.
    for (const entry of ALLOWED_METHODS) {
      if (entry.redact) {
        expect(entry.redactionNote ?? '').not.toBe('');
      }
    }
  });
});

describe('redactNetworkInfo', () => {
  it('removes the node own addresses', () => {
    const answer = redactNetworkInfo({
      version: 280000,
      subversion: '/Satoshi:28.0.0/',
      localaddresses: [{ address: '203.0.113.4', port: 8333, score: 4 }],
    }) as Record<string, unknown>;
    expect(JSON.stringify(answer)).not.toContain('203.0.113.4');
    expect(answer.version).toBe(280000);
  });

  it('says the field was removed rather than dropping it silently', () => {
    // An absent key reads as a node that reported nothing. A marker reads as
    // a node that reported something this route will not repeat.
    const answer = redactNetworkInfo({ localaddresses: [] }) as Record<string, unknown>;
    expect(String(answer.localaddresses)).toContain('removed');
  });

  it('keeps everything else exactly as it was', () => {
    const original = {
      version: 280000,
      relayfee: 0.00001,
      networks: [{ name: 'onion', reachable: true }],
      localaddresses: [],
    };
    const answer = redactNetworkInfo(original) as Record<string, unknown>;
    expect(answer.relayfee).toBe(0.00001);
    expect(answer.networks).toEqual([{ name: 'onion', reachable: true }]);
  });

  it('passes a non object through rather than throwing on it', () => {
    expect(redactNetworkInfo(null)).toBeNull();
    expect(redactNetworkInfo('nope')).toBe('nope');
  });
});

describe('redactPeerInfo', () => {
  const peer = {
    id: 3,
    addr: '198.51.100.7:8333',
    addrbind: '10.0.0.5:41234',
    addrlocal: '203.0.113.4:8333',
    mapped_as: 64512,
    network: 'ipv4',
    inbound: false,
    conntime: 1756000000,
    pingtime: 0.042,
    version: 70016,
    subver: '/Satoshi:28.0.0/',
    relaytxes: true,
    servicesnames: ['NETWORK', 'WITNESS'],
  };

  it('removes every address a peer carries', () => {
    const [answer] = redactPeerInfo([peer]) as Record<string, unknown>[];
    expect(answer.addr).toBeUndefined();
    expect(answer.addrbind).toBeUndefined();
    expect(answer.addrlocal).toBeUndefined();
    expect(answer.mapped_as).toBeUndefined();
  });

  it('leaves no trace of an address anywhere in the answer', () => {
    // Asserted against the serialized answer, so a field added to Core later
    // that happens to carry an address is caught by the fixture rather than
    // slipping through a per key check.
    const serialized = JSON.stringify(redactPeerInfo([peer]));
    expect(serialized).not.toContain('198.51.100.7');
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).not.toContain('203.0.113.4');
  });

  it('keeps what a peer does, which is the reason the page exists', () => {
    const [answer] = redactPeerInfo([peer]) as Record<string, unknown>[];
    expect(answer.network).toBe('ipv4');
    expect(answer.inbound).toBe(false);
    expect(answer.pingtime).toBe(0.042);
    expect(answer.subver).toBe('/Satoshi:28.0.0/');
    expect(answer.relaytxes).toBe(true);
    expect(answer.servicesnames).toEqual(['NETWORK', 'WITNESS']);
  });

  it('handles an empty peer list and a node with no peers', () => {
    expect(redactPeerInfo([])).toEqual([]);
  });

  it('passes a non array through rather than throwing on it', () => {
    expect(redactPeerInfo(null)).toBeNull();
    expect(redactPeerInfo({ not: 'an array' })).toEqual({ not: 'an array' });
  });
});

describe('readArguments', () => {
  it('takes no arguments for a method that declares none', () => {
    expect(readArguments(method('getblockcount'), [])).toEqual([]);
    expect(readArguments(method('getblockcount'), undefined)).toEqual([]);
  });

  it('refuses an argument past the last declared parameter', () => {
    // Dropping it would tell a caller their request was understood when the
    // extra argument was thrown away.
    const answer = readArguments(method('getblockcount'), ['surprise']);
    expect(answer).toHaveProperty('message');
    expect((answer as { message: string }).message).toContain('at most 0');
  });

  it('refuses arguments that are not an array', () => {
    const answer = readArguments(method('getblockhash'), { height: 1 });
    expect((answer as { message: string }).message).toContain('array');
  });

  it('refuses a missing required argument', () => {
    const answer = readArguments(method('getblockhash'), []);
    expect((answer as { message: string }).message).toContain('needs height');
  });

  it('reads a height and refuses a non height', () => {
    expect(readArguments(method('getblockhash'), ['800000'])).toEqual([800000]);
    expect(readArguments(method('getblockhash'), [800000])).toEqual([800000]);
    expect(readArguments(method('getblockhash'), ['-1'])).toHaveProperty('message');
    expect(readArguments(method('getblockhash'), ['1.5'])).toHaveProperty('message');
    expect(readArguments(method('getblockhash'), ['soon'])).toHaveProperty('message');
    expect(readArguments(method('getblockhash'), ['999999999'])).toHaveProperty('message');
  });

  it('reads a transaction id and lowercases it', () => {
    const upper = 'A'.repeat(64);
    expect(readArguments(method('getmempoolentry'), [upper])).toEqual(['a'.repeat(64)]);
  });

  it('refuses anything that is not 64 hexadecimal characters', () => {
    expect(readArguments(method('getmempoolentry'), ['abc'])).toHaveProperty('message');
    expect(readArguments(method('getmempoolentry'), ['z'.repeat(64)])).toHaveProperty('message');
    expect(readArguments(method('getmempoolentry'), ['a'.repeat(65)])).toHaveProperty('message');
  });

  it('reads hexadecimal and refuses an odd length', () => {
    expect(readArguments(method('decodescript'), ['DEADBEEF'])).toEqual(['deadbeef']);
    expect(readArguments(method('decodescript'), ['abc'])).toHaveProperty('message');
    expect(readArguments(method('decodescript'), ['nothex'])).toHaveProperty('message');
  });

  it('refuses hexadecimal large enough to be a payload', () => {
    const huge = 'ab'.repeat(1_500_000);
    expect(readArguments(method('decoderawtransaction'), [huge])).toHaveProperty('message');
  });

  it('reads a bounded count and refuses one past the bound', () => {
    expect(readArguments(method('estimatesmartfee'), ['6'])).toEqual([6]);
    expect(readArguments(method('estimatesmartfee'), ['1008'])).toEqual([1008]);
    expect(readArguments(method('estimatesmartfee'), ['1009'])).toHaveProperty('message');
    expect(readArguments(method('estimatesmartfee'), ['0'])).toHaveProperty('message');
  });

  it('reads a boolean written either way', () => {
    expect(readArguments(method('getblockheader'), ['a'.repeat(64), 'true'])).toEqual([
      'a'.repeat(64), true,
    ]);
    expect(readArguments(method('getblockheader'), ['a'.repeat(64), false])).toEqual([
      'a'.repeat(64), false,
    ]);
    expect(readArguments(method('getblockheader'), ['a'.repeat(64), 'yes'])).toHaveProperty('message');
  });

  it('stops at the first absent optional argument', () => {
    // Passing undefined through would send a null into a position the node
    // reads by index, which is a different call from the one intended.
    const answer = readArguments(method('gettxout'), ['a'.repeat(64), 0]);
    expect(answer).toEqual(['a'.repeat(64), 0]);
  });

  it('reads all three arguments when all three are given', () => {
    expect(readArguments(method('gettxout'), ['a'.repeat(64), '2', 'true']))
      .toEqual(['a'.repeat(64), 2, true]);
  });

  it('refuses an output position that is not one', () => {
    expect(readArguments(method('gettxout'), ['a'.repeat(64), '-1'])).toHaveProperty('message');
    expect(readArguments(method('gettxout'), ['a'.repeat(64), 'first'])).toHaveProperty('message');
  });

  it('checks an address for shape without claiming it is valid', () => {
    // The node's own answer is the authority on validity; this is only a
    // guard against sending it something absurd.
    expect(readArguments(method('validateaddress'), ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4']))
      .toEqual(['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4']);
    expect(readArguments(method('validateaddress'), ['short'])).toHaveProperty('message');
    expect(readArguments(method('validateaddress'), ['has space in it'])).toHaveProperty('message');
  });

  it('trims surrounding whitespace before checking', () => {
    expect(readArguments(method('getblockhash'), [' 800000 '])).toEqual([800000]);
  });
});
