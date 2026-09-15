import { readFileSync } from 'fs';
import { resolve } from 'path';
import { decodeBolt12Offer } from './bolt12-decoder';
const vectors: Array<{ description: string; valid: boolean; bolt12: string }> = JSON.parse(readFileSync(resolve(__dirname, '../../../../tools/bolt12-proof/testdata/offers-test.json'), 'utf8'));
const minimum = vectors.find(v => v.description === 'Minimal bolt12 offer')!.bolt12;

describe('actual pinned LDK offer decoder and official BOLT vectors', () => {
  it.each(vectors.map(v => [v.description, v] as const))('%s', async (_description, vector) => {
    try {
      const result = await decodeBolt12Offer({ offer: vector.bolt12, network: 'mainnet' }, 'mainnet');
      expect(result.syntax_valid && !result.unknown_required_features).toBe(vector.valid);
      expect(result.signature_status).toBe('not-applicable-unsigned-offer');
      expect(result.payment_verified).toBe(false);
    } catch (error) {
      expect(vector.valid).toBe(false);
      expect(error).toMatchObject({ code: 'invalid-offer', status: 400 });
    }
  });
  it('keeps an absent amount/description distinct from zero and binds selected chain', async () => {
    const main = await decodeBolt12Offer({ offer: minimum, network: 'mainnet' }, 'mainnet');
    expect(main).toMatchObject({ amount: null, description: null, network_compatible: true, usable_for_invoice_request: true });
    const signet = await decodeBolt12Offer({ offer: minimum, network: 'signet' }, 'signet');
    expect(signet).toMatchObject({ syntax_valid: true, network_compatible: false, usable_for_invoice_request: false });
    expect(signet.input_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([
    { offer: minimum, network: 'regtest' },
    { offer: 'x'.repeat(16385), network: 'signet' },
    { offer: '', network: 'signet' },
    { offer: minimum },
  ])('rejects mismatched network or unbounded input before native decoding', async request => {
    await expect(decodeBolt12Offer(request, 'signet')).rejects.toMatchObject({ code: 'invalid-input', status: 400 });
  });
  it('does not mistake invoice/request prefixes for an unsigned offer', async () => {
    await expect(decodeBolt12Offer({ offer: minimum.replace('lno1', 'lni1'), network: 'mainnet' }, 'mainnet')).rejects.toMatchObject({ code: 'invalid-offer' });
  });
});

describe('exact offer amounts and expiry semantics', () => {
  it('preserves native-generated values above JavaScript safe integer precision', async () => {
    const fixture = JSON.parse(readFileSync(resolve(__dirname, '../../../../tools/bolt12-proof/testdata/signet-offer.json'), 'utf8'));
    const result = await decodeBolt12Offer({ offer: fixture.offer, network: 'signet' }, 'signet');
    expect(result).toMatchObject({ amount: { kind: 'bitcoin', amount_msat: '9007199254740993' }, quantity: { kind: 'bounded', maximum: '9007199254740993' }, usable_for_invoice_request: true, payment_verified: false });
  });
  it('applies the specified after-expiry boundary without treating expiration as malformed syntax', async () => {
    const fixture = vectors.find(v => v.description === 'with expiry')!;
    const initial = await decodeBolt12Offer({ offer: fixture.bolt12, network: 'mainnet' }, 'mainnet');
    const expiry = Number(initial.absolute_expiry);
    const clock = jest.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(expiry * 1000);
      expect(await decodeBolt12Offer({ offer: fixture.bolt12, network: 'mainnet' }, 'mainnet')).toMatchObject({ syntax_valid: true, expired: false });
      clock.mockReturnValue((expiry + 1) * 1000);
      expect(await decodeBolt12Offer({ offer: fixture.bolt12, network: 'mainnet' }, 'mainnet')).toMatchObject({ syntax_valid: true, expired: true, usable_for_invoice_request: false });
    } finally { clock.mockRestore(); }
  });
});

describe('official BOLT12 string presentation vectors', () => {
  const formats: Array<{ comment: string; valid: boolean; string: string }> = JSON.parse(readFileSync(resolve(__dirname, '../../../../tools/bolt12-proof/testdata/format-string-test.json'), 'utf8'));
  it.each(formats.map(v => [v.comment, v] as const))('%s', async (_comment, vector) => {
    if (vector.valid) expect(await decodeBolt12Offer({ offer: vector.string, network: 'mainnet' }, 'mainnet')).toMatchObject({ syntax_valid: true });
    else await expect(decodeBolt12Offer({ offer: vector.string, network: 'mainnet' }, 'mainnet')).rejects.toMatchObject({ code: 'invalid-offer' });
  });
});
