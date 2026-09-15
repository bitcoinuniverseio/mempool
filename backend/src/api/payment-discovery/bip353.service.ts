import { execFile } from 'child_process';
import { isIP } from 'net';
import { isAbsolute } from 'path';

export class Bip353Error extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export function bip353QueryName(input: unknown): string {
  if (typeof input !== 'string' || input.length > 254) throw new Bip353Error('invalid-name', 'Enter an ASCII BIP353 user@domain name.');
  const name = input.trim().replace(/^₿/, '').toLowerCase();
  const parts = name.split('@');
  const validLabels = (text: string): boolean => text.split('.').every(label => /^[a-z0-9_-]{1,63}$/.test(label));
  if (parts.length !== 2 || !validLabels(parts[0]) || !validLabels(parts[1])) {
    throw new Bip353Error('invalid-name', 'Enter an ASCII BIP353 user@domain name.');
  }
  const query = `${parts[0]}.user._bitcoin-payment.${parts[1]}.`;
  if (query.length > 254) throw new Bip353Error('invalid-name', 'The BIP353 DNS name is too long.');
  return query;
}

/** An owned process builds and validates proofs; the browser verifies them again. */
export class Bip353Service {
  private active = 0;

  async resolve(input: unknown): Promise<{ name: string; proof: string; ttl: number }> {
    const name = bip353QueryName(input);
    const executable = process.env.BIP353_PROVER_EXECUTABLE;
    const resolver = process.env.BIP353_DNS_RESOLVER;
    if (!executable || !isAbsolute(executable) || !resolver || !/^\d+\.\d+\.\d+\.\d+:\d+$/.test(resolver)
      || !isIP(resolver.split(':')[0]) || Number(resolver.split(':')[1]) < 1 || Number(resolver.split(':')[1]) > 65535) {
      throw new Bip353Error('resolver-unavailable', 'The owned DNSSEC proof resolver is not configured.', 503);
    }
    if (this.active >= 4) throw new Bip353Error('resolver-busy', 'The DNSSEC resolver is busy. Retry shortly.', 429);
    this.active++;
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(executable, [resolver, name], { timeout: 10000, maxBuffer: 1400000, windowsHide: true, encoding: 'utf8' }, (error, output) => {
          if (error) reject(new Bip353Error('resolution-failed', 'No authenticated payment instructions could be resolved. The name may be absent, unsigned, bogus, or the resolver unavailable.', 502));
          else resolve(output);
        });
      });
      let result: any;
      try { result = JSON.parse(stdout); } catch { throw new Bip353Error('invalid-proof-response', 'The DNSSEC proof resolver returned an invalid response.', 502); }
      if (result?.validation?.name !== name || result?.validation?.dnssecValid !== true
        || typeof result.proof !== 'string' || result.proof.length > 1333336 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.proof)
        || !Number.isSafeInteger(result.ttl) || result.ttl < 0) {
        throw new Bip353Error('invalid-proof-response', 'The DNSSEC proof resolver did not provide a verified proof.', 502);
      }
      return { name, proof: result.proof, ttl: result.ttl };
    } finally { this.active--; }
  }
}

export const bip353Service = new Bip353Service();
