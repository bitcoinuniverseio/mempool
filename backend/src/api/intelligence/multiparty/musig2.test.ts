import fs from 'fs';
import path from 'path';
import { aggregateKeys, aggregateNonces, aggregatePartials, publicSession, verifyPartial, CURVE_ORDER } from './musig2';

const fixture = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors', name + '_vectors.json'), 'utf8'));
const bytes = (value: string): Buffer => Buffer.from(value, 'hex');
const select = (values: string[], indices: number[]): Buffer[] => indices.map(index => bytes(values[index]));
const keyVectors = fixture('key_agg');
const nonceVectors = fixture('nonce_agg');
const verifyVectors = fixture('sign_verify');
const sigVectors = fixture('sig_agg');

describe('BIP327 official public algorithm vectors', () => {
  for (const [index, test] of keyVectors.valid_test_cases.entries()) {
    it('KeyAgg valid vector ' + index + ' (including duplicate and reordered keys)', () => {
      expect(Buffer.from(aggregateKeys(select(keyVectors.pubkeys, test.key_indices)).publicKey).toString('hex'))
        .toBe(test.expected.toLowerCase());
    });
  }
  for (const [index, test] of keyVectors.error_test_cases.entries()) {
    if (test.tweak_indices.length) continue; // Tweak support is explicitly outside the public API scope.
    it('KeyAgg invalid point vector ' + index, () => {
      expect(() => aggregateKeys(select(keyVectors.pubkeys, test.key_indices))).toThrow();
    });
  }
  for (const [index, test] of nonceVectors.valid_test_cases.entries()) {
    it('NonceAgg valid vector ' + index + ' (including an infinity aggregate half)', () => {
      expect(Buffer.from(aggregateNonces(select(nonceVectors.pnonces, test.pnonce_indices))).toString('hex'))
        .toBe(test.expected.toLowerCase());
    });
  }
  for (const [index, test] of nonceVectors.error_test_cases.entries()) {
    it('NonceAgg malformed point vector ' + index, () => {
      expect(() => aggregateNonces(select(nonceVectors.pnonces, test.pnonce_indices))).toThrow();
    });
  }
  for (const [index, test] of verifyVectors.valid_test_cases.entries()) {
    it('PartialSigVerify valid vector ' + index + ' (including infinity, empty and long messages)', () => {
      const context = publicSession(aggregateKeys(select(verifyVectors.pubkeys, test.key_indices)),
        select(verifyVectors.pnonces, test.nonce_indices), bytes(verifyVectors.msgs[test.msg_index]));
      expect(Buffer.from(context.aggregateNonce).toString('hex')).toBe(verifyVectors.aggnonces[test.aggnonce_index].toLowerCase());
      expect(verifyPartial(context, test.signer_index, bytes(test.expected))).toBe(true);
    });
  }
  for (const [index, test] of verifyVectors.verify_fail_test_cases.entries()) {
    it('PartialSigVerify invalid signature vector ' + index, () => {
      const context = publicSession(aggregateKeys(select(verifyVectors.pubkeys, test.key_indices)),
        select(verifyVectors.pnonces, test.nonce_indices), bytes(verifyVectors.msgs[test.msg_index]));
      expect(verifyPartial(context, test.signer_index, bytes(test.sig))).toBe(false);
    });
  }
  for (const [index, test] of verifyVectors.verify_error_test_cases.entries()) {
    it('PartialSigVerify invalid context vector ' + index, () => {
      expect(() => publicSession(aggregateKeys(select(verifyVectors.pubkeys, test.key_indices)),
        select(verifyVectors.pnonces, test.nonce_indices), bytes(verifyVectors.msgs[test.msg_index]))).toThrow();
    });
  }
  for (const [index, test] of sigVectors.valid_test_cases.entries()) {
    if (test.tweak_indices.length) continue;
    it('PartialSigAgg untweaked vector ' + index, () => {
      const context = publicSession(aggregateKeys(select(sigVectors.pubkeys, test.key_indices)),
        select(sigVectors.pnonces, test.nonce_indices), bytes(sigVectors.msg));
      expect(Buffer.from(aggregatePartials(context, select(sigVectors.psigs, test.psig_indices))).toString('hex'))
        .toBe(test.expected.toLowerCase());
      expect(() => aggregatePartials(context, [bytes(CURVE_ORDER.toString(16)), bytes(sigVectors.psigs[1])])).toThrow(/curve order/);
    });
  }
});
