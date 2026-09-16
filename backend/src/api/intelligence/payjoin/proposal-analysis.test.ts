import { Psbt, payments, Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { compareProposal } from './proposal-analysis';
import { payjoinService } from './payjoin.service';

const senderKey = Buffer.alloc(32, 1), receiverKey = Buffer.alloc(32, 2);
const sender = { publicKey: Buffer.from(ecc.pointFromScalar(senderKey)!), sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, senderKey)) };
const receiver = { publicKey: Buffer.from(ecc.pointFromScalar(receiverKey)!), sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, receiverKey)) };
const senderScript = payments.p2wpkh({ pubkey: sender.publicKey }).output!;
const receiverScript = payments.p2wpkh({ pubkey: receiver.publicKey }).output!;
function pair(change = 39000) {
  const original = new Psbt().addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { value: 100000, script: senderScript } })
    .addOutput({ script: receiverScript, value: 60000 }).addOutput({ script: senderScript, value: 39000 });
  original.signInput(0, sender).finalizeAllInputs();
  const proposal = new Psbt().addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { value: 100000, script: senderScript } })
    .addInput({ hash: '22'.repeat(32), index: 0, witnessUtxo: { value: 25000, script: receiverScript } })
    .addOutput({ script: receiverScript, value: 84500 }).addOutput({ script: senderScript, value: change });
  proposal.signInput(1, receiver).finalizeInput(1);
  delete proposal.data.inputs[0].witnessUtxo;
  return { original, proposal, request: { original_psbt: original.toBase64(), proposal_psbt: proposal.toBase64() } };
}
describe('BIP78 sender comparison boundaries', () => {
  it('checks original and receiver signatures in the actual native transaction engine', async () => {
    const fixture = pair();
    const result = await payjoinService.analyzeProposalWithSignatures(fixture.request);
    expect(result).toMatchObject({ signatures_verified: true, is_valid: null, chain_verified: null });
    const signature = fixture.proposal.data.inputs[1].finalScriptWitness!;
    signature[10] ^= 1;
    const invalid = await payjoinService.analyzeProposalWithSignatures({ ...fixture.request, proposal_psbt: fixture.proposal.toBase64() });
    expect(invalid).toMatchObject({ signatures_verified: false, is_valid: false });
  });
  it('restores sender UTXOs from original and computes fees for compliant omission', () => {
    const { request } = pair();
    const result = payjoinService.analyzeProposal(request);
    expect(result).toMatchObject({ structural_checks_passed: true, psbt_envelope_checks_passed: true, is_valid: null, original_fee_sats: 1000, proposal_fee_sats: 1500, signatures_verified: null, chain_verified: null });
  });
  it('rejects sender-output theft despite increased total fees', () => {
    const { request } = pair(30000);
    expect(payjoinService.analyzeProposal(request)).toMatchObject({ is_valid: false, structural_checks_passed: false });
  });
  it('bounds explicitly authorized fee reduction by amount, fee increase and input cost', () => {
    const { request } = pair(38800);
    const authorized = { ...request, payment_output_index: 0, additional_fee_output_index: 1, max_additional_fee_contribution: 200 };
    expect(compareProposal(authorized).messages).toEqual([]);
    expect(compareProposal({ ...authorized, max_additional_fee_contribution: 199 }).messages.join(' ')).toMatch(/authorization/);
    expect(compareProposal({ ...pair(38000).request, payment_output_index: 0, additional_fee_output_index: 1, max_additional_fee_contribution: 1000 }).messages.join(' ')).toMatch(/input fee bound/);
  });
  it('never treats missing input evidence as a zero fee or acceptable fee', () => {
    const fixture = pair(); delete fixture.original.data.inputs[0].witnessUtxo;
    const result = payjoinService.analyzeProposal({ ...fixture.request, original_psbt: fixture.original.toBase64() });
    expect(result).toMatchObject({ is_valid: false, original_fee_sats: null, proposal_fee_sats: null });
  });
  it('rejects fabricated sender values and previous transaction identities', () => {
    const fixture = pair(); fixture.proposal.data.inputs[0].witnessUtxo = { value: 200000, script: senderScript };
    expect(() => compareProposal({ ...fixture.request, proposal_psbt: fixture.proposal.toBase64() })).toThrow(/changed sender UTXO/);
    const tx = new Transaction(); tx.addInput(Buffer.alloc(32, 3), 0); tx.addOutput(senderScript, 100000);
    fixture.original.data.inputs[0].nonWitnessUtxo = tx.toBuffer();
    expect(() => compareProposal({ ...fixture.request, original_psbt: fixture.original.toBase64() })).toThrow(/outpoint/);
  });
  it('checks version, locktime and input sequence independently of amounts', () => {
    for (const mutate of [(p: Psbt) => p.setVersion(1), (p: Psbt) => p.setLocktime(1), (p: Psbt) => p.setInputSequence(0, 1)]) {
      const fixture = pair(); delete fixture.proposal.data.inputs[1].finalScriptWitness;
      mutate(fixture.proposal);
      expect(compareProposal({ ...fixture.request, proposal_psbt: fixture.proposal.toBase64() }).messages.length).toBeGreaterThan(0);
    }
  });
  it('requires explicit payment substitution and never applies it to sender outputs', () => {
    const fixture = pair(); delete fixture.proposal.data.inputs[1].finalScriptWitness;
    fixture.proposal.updateOutput(0, {});
    const changed = new Psbt().addInput({ hash: '11'.repeat(32), index: 0 }).addInput({ hash: '22'.repeat(32), index: 0, witnessUtxo: { value: 25000, script: receiverScript } })
      .addOutput({ script: Buffer.from('51','hex'), value: 84500 }).addOutput({ script: senderScript, value: 39000 });
    const request = { ...fixture.request, proposal_psbt: changed.toBase64() };
    expect(compareProposal(request).messages.join(' ')).toMatch(/output 0/);
    expect(compareProposal({ ...request, payment_output_index: 0, disable_output_substitution: false }).messages).toEqual([]);
  });
  it('does not reuse a single output to match duplicate original scripts', () => {
    const original = new Psbt().addInput({ hash: '11'.repeat(32), index: 0, witnessUtxo: { value: 100000, script: senderScript } })
      .addOutput({ script: senderScript, value: 40000 }).addOutput({ script: senderScript, value: 40000 });
    const proposal = new Psbt().addInput({ hash: '11'.repeat(32), index: 0 }).addOutput({ script: senderScript, value: 40000 });
    expect(compareProposal({ original_psbt: original.toBase64(), proposal_psbt: proposal.toBase64() }).messages.join(' ')).toMatch(/output 1/);
  });
});
