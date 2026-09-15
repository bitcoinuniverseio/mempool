import { execFile } from 'child_process';
import { Bip353Service, bip353QueryName } from './bip353.service';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
const execute = execFile as unknown as jest.Mock;
const oldExecutable = process.env.BIP353_PROVER_EXECUTABLE;
const oldResolver = process.env.BIP353_DNS_RESOLVER;
afterEach(() => {
  if (oldExecutable === undefined) delete process.env.BIP353_PROVER_EXECUTABLE; else process.env.BIP353_PROVER_EXECUTABLE = oldExecutable;
  if (oldResolver === undefined) delete process.env.BIP353_DNS_RESOLVER; else process.env.BIP353_DNS_RESOLVER = oldResolver;
  jest.resetAllMocks();
});

describe('owned BIP353 proof resolution boundary', () => {
  it('maps prefixed names and sublabels to the exact BIP353 owner', () => {
    expect(bip353QueryName('₿Alice@Example.COM')).toBe('alice.user._bitcoin-payment.example.com.');
    expect(bip353QueryName('a.b@dnssec_proof_tests.example')).toBe('a.b.user._bitcoin-payment.dnssec_proof_tests.example.');
  });

  it.each([null, [], '', 'a', 'a@@b', 'a@b/', 'a@localhost:53', 'a@éxample.com', 'a@-bad..example', 'a'.repeat(64) + '@example.com'])('rejects malformed names %j before execution', input => {
    expect(() => bip353QueryName(input)).toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not substitute public DNS or unverified TXT when the owned resolver is missing', async () => {
    delete process.env.BIP353_PROVER_EXECUTABLE;
    delete process.env.BIP353_DNS_RESOLVER;
    await expect(new Bip353Service().resolve('a@example.com')).rejects.toMatchObject({ code: 'resolver-unavailable', status: 503 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses fixed arguments, timeout, output limit and hidden child window', async () => {
    process.env.BIP353_PROVER_EXECUTABLE = process.platform === 'win32' ? 'D:\\test-owned\\query.exe' : '/test-owned/query';
    process.env.BIP353_DNS_RESOLVER = '127.0.0.1:5353';
    execute.mockImplementation((_exe, _args, _options, callback) => callback(null, JSON.stringify({
      validation: { name: 'a.user._bitcoin-payment.example.com.', dnssecValid: true }, proof: 'AA==', ttl: 30,
    })));
    await expect(new Bip353Service().resolve('a@example.com')).resolves.toMatchObject({ ttl: 30, proof: 'AA==' });
    expect(execute.mock.calls[0][1]).toEqual(['127.0.0.1:5353', 'a.user._bitcoin-payment.example.com.']);
    expect(execute.mock.calls[0][2]).toMatchObject({ timeout: 10000, maxBuffer: 1400000, windowsHide: true });
    // This boundary forwards proof bytes; actual independent cryptographic acceptance
    // is covered with root-signed and tampered official fixtures in browser WASM tests.
  });

  it('rejects resolver failure and unbound response names instead of falling back to a success', async () => {
    process.env.BIP353_PROVER_EXECUTABLE = process.platform === 'win32' ? 'D:\\test-owned\\query.exe' : '/test-owned/query';
    process.env.BIP353_DNS_RESOLVER = '127.0.0.1:5353';
    execute.mockImplementationOnce((_exe, _args, _options, callback) => callback(new Error('timeout'), ''));
    await expect(new Bip353Service().resolve('a@example.com')).rejects.toMatchObject({ code: 'resolution-failed' });
    execute.mockImplementationOnce((_exe, _args, _options, callback) => callback(null, JSON.stringify({
      validation: { name: 'other.example.', dnssecValid: true }, proof: 'AA==', ttl: 30,
    })));
    await expect(new Bip353Service().resolve('a@example.com')).rejects.toMatchObject({ code: 'invalid-proof-response' });
  });
});
