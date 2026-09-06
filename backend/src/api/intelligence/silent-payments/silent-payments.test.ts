import { Psbt } from 'bitcoinjs-lib';
import { bech32m } from 'bech32';
import { decodeSilentAddress, inspectPsbt } from './silent-payments-parsers';
import { buildSilentPaymentBundle, eligibleInputKey } from './silent-payments-ingestion';
const vectors: { valid: {description:string;psbt:string}[]; invalid_structure: {description:string;psbt:string}[] } = require('./bip375-public-vectors.json');
const scan = '0220bcfac5b99e04ad1a06ddfb016ee13582609d60b6291e98d01a9bc9a16c96d4';
const spend = '025cc9856d6f8375350e123978daac200c260cb5b5ae83106cab90484dcd8fcf36';
const address = 'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv';
function record(key: Buffer, value: Buffer): Buffer { return Buffer.concat([Buffer.from([key.length]), key, Buffer.from([value.length]), value]); }
const field = (key: number, value: string) => record(Buffer.from([key]), Buffer.from(value, 'hex'));
const zero = Buffer.from([0]);
function v2(input = Buffer.alloc(0), output = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from('70736274ff', 'hex'), field(0xfb,'02000000'), field(2,'02000000'), field(4,'01'), field(5,'01'), zero,
    field(0x0e,'00'.repeat(32)), field(0x0f,'00000000'), input, zero, field(3,'0100000000000000'), field(4,'51'), output, zero]).toString('base64');
}

describe('BIP352 address parser', () => {
  it('decodes official independent address and expected keys', () => {
    expect(decodeSilentAddress(address, 'mainnet')).toMatchObject({ valid: true, version: 0, scan_pubkey: scan, spend_pubkey: spend });
    expect(decodeSilentAddress(address.toUpperCase(), 'mainnet').valid).toBe(true);
  });
  it.each(['sp1q' + '!'.repeat(113), address.slice(0,-1) + 'x', 'SP' + address.slice(2), null, {}, 'x'.repeat(1024)])('rejects malformed address %p', value => expect(decodeSilentAddress(value).valid).toBe(false));
  it('rejects invalid curve points, padding and network mismatch', () => {
    expect(decodeSilentAddress(bech32m.encode('sp',[0,...bech32m.toWords(Buffer.alloc(66))],1023)).valid).toBe(false);
    expect(decodeSilentAddress(bech32m.encode('sp',[0,...bech32m.toWords(Buffer.from(scan+spend,'hex')),1],1023)).valid).toBe(false);
    expect(decodeSilentAddress(address,'signet').valid).toBe(false);
    const test = bech32m.encode('tsp',bech32m.decode(address,1023).words,1023);
    expect(decodeSilentAddress(test)).toMatchObject({ valid: true, network: 'test-network' });
    expect(decodeSilentAddress(test,'signet')).toMatchObject({ valid: true, network: 'signet' });
  });
  it('handles compatible address versions explicitly and rejects reserved v31', () => {
    const words=bech32m.decode(address,1023).words;
    expect(decodeSilentAddress(bech32m.encode('sp',[1,...words.slice(1)],1023))).toMatchObject({valid:true,compatibility:'v0-compatible'});
    expect(decodeSilentAddress(bech32m.encode('sp',[31,...words.slice(1)],1023)).valid).toBe(false);
  });
  it('extracts BIP321 Silent Payment instructions while validating URI syntax', () => {
    expect(decodeSilentAddress(`BITCOIN:?SP=${address}&label=Receiver%20one`, 'mainnet')).toMatchObject({ valid: true, scan_pubkey: scan, spend_pubkey: spend, input_format: 'bip321' });
    expect(decodeSilentAddress(`bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?sp=${address}&amount=0.001`, 'mainnet').valid).toBe(true);
    expect(decodeSilentAddress(`bitcoin:?req-sp=${address}`, 'mainnet').valid).toBe(true);
  });
  it.each([
    `bitcoin:?sp=${address}&req-unknown=1`,
    `bitcoin:?sp=${address}&amount=1&AMOUNT=2`,
    `bitcoin:?sp=${address}&label=one&Label=two`,
    `bitcoin:?sp=${address}&amount=1,000`,
    `bitcoin:?sp=${address}&label=%zz`,
    `bitcoin:?sp=${address}#fragment`,
    `bitcoin:not-an-address?sp=${address}`,
    `bitcoin:?sp=${address}&sp=${address}`,
    `bitcoin:${address}`,
  ])('rejects malformed or ambiguous URI instructions: %s', uri => expect(decodeSilentAddress(uri, 'mainnet').valid).toBe(false));
});

describe('PSBT structural inspection', () => {
  it.each(['cHNidFg=', 'cHNidP8=', 'cHNidP8A', 'cHNidP8B', 'cHNidP8B!!!!', 'cHNidP8=', 'cHNidP8BAP///////w==', 'a'.repeat(1398105), null, {}])('rejects malformed, incomplete or oversized input', value => expect(inspectPsbt(value).valid).toBe(false));
  it('accepts an ordinary independently encoded PSBT with neither field family', () => {
    const psbt = new Psbt().addInput({hash:'01'.repeat(32),index:0}).addOutput({script:Buffer.from('51','hex'),value:1});
    expect(inspectPsbt(psbt.toBase64())).toMatchObject({valid:true,bip375_present:false,bip376_present:false,cryptographically_verified:false});
  });
  it.each(vectors.valid.map(v => [v.description,v.psbt] as [string,string]))('accepts official BIP375 structural vector: %s', (_label, psbt) => expect(inspectPsbt(psbt)).toMatchObject({valid:true,bip375_present:true,cryptographically_verified:false}));
  it.each(vectors.invalid_structure.map(v => [v.description,v.psbt] as [string,string]))('rejects official structural counterexample: %s', (_label, psbt) => expect(inspectPsbt(psbt).valid).toBe(false));
  it('validates both BIP376 draft fields without claiming tweak verification', () => {
    const derivation=record(Buffer.from('1f'+spend,'hex'),Buffer.alloc(4));
    expect(inspectPsbt(v2(Buffer.concat([derivation,field(0x20,'01'.repeat(32))])))).toMatchObject({valid:true,bip375_present:false,bip376_present:true,cryptographically_verified:false});
    expect(inspectPsbt(v2(field(0x20,'01'.repeat(31)))).valid).toBe(false);
    expect(inspectPsbt(v2(record(Buffer.from('1f'+spend,'hex'),Buffer.alloc(3)))).valid).toBe(false);
  });
  it('rejects duplicate keys, trailing bytes and absent required maps', () => {
    expect(inspectPsbt(v2(field(0x0f,'01000000'))).valid).toBe(false);
    expect(inspectPsbt(Buffer.concat([Buffer.from(v2(),'base64'),zero]).toString('base64')).valid).toBe(false);
    expect(inspectPsbt(Buffer.from(v2(),'base64').subarray(0,-1).toString('base64')).valid).toBe(false);
  });
  it('does not confuse proprietary strings with standard SP fields', () => expect(inspectPsbt(v2(record(Buffer.from('fc0773705f73656e6400','hex'),Buffer.from('sp_spend'))))).toMatchObject({valid:true,bip375_present:false,bip376_present:false}));
  it('rejects malformed witness UTXOs and incomplete proprietary keys', () => {
    expect(inspectPsbt(v2(field(1,'01'))).valid).toBe(false);
    expect(inspectPsbt(v2(record(Buffer.from('fc0773705f73656e64','hex'),Buffer.from('sp_spend')))).valid).toBe(false);
  });
  it('rejects malformed ordinary key-value fields in PSBTv2', () => {
    expect(inspectPsbt(v2(field(6,'00000000'))).valid).toBe(false);
    expect(inspectPsbt(v2(record(Buffer.from('06'+spend,'hex'),Buffer.alloc(3)))).valid).toBe(false);
    expect(inspectPsbt(v2(Buffer.alloc(0),record(Buffer.from('07'+spend.slice(2),'hex'),Buffer.from('ff','hex')))).valid).toBe(false);
    expect(inspectPsbt(v2(record(Buffer.from('02'+spend,'hex'),Buffer.from('ff','hex')))).valid).toBe(false);
    expect(inspectPsbt(v2(field(0x0a,'00'))).valid).toBe(false);
  });
});

describe('first-party block bundle computation (controlled source fixtures)', () => {
  const input:any={txid:'01'.repeat(32),vout:0,is_coinbase:false,scriptsig:'',witness:['00'.repeat(64)],prevout:{scriptpubkey:'5120'+scan.slice(2)}};
  const block:any={height:12,id:'02'.repeat(32),previousblockhash:'03'.repeat(32),tx_count:1,timestamp:1700000000};
  const tx:any={txid:'04'.repeat(32),vin:[input],vout:[{scriptpubkey:'5120'+spend.slice(2),value:1}]};
  it('is deterministic, network scoped and counts candidates without calling them payments', () => {
    const first=buildSilentPaymentBundle('signet',block,[tx]);
    expect(buildSilentPaymentBundle('signet',block,[tx])).toEqual(first);
    expect(buildSilentPaymentBundle('mainnet',block,[tx]).manifest.bundle_hash).not.toBe(first.manifest.bundle_hash);
    expect(first.manifest).toMatchObject({candidate_output_count:1,num_inputs:1,network:'signet'});
    expect(first.bundle.transactions[0].candidate_outputs[0].amount_sats).toBe('1');
  });
  it('rejects incomplete blocks and missing prevouts rather than claiming no matches', () => {
    expect(()=>buildSilentPaymentBundle('signet',block,[])).toThrow();
    expect(()=>buildSilentPaymentBundle('signet',block,[{...tx,vin:[{...input,prevout:null}]}])).toThrow(/prevout/);
    expect(()=>buildSilentPaymentBundle('signet',block,[{...tx,vin:[{...input,witness:[]}]}])).toThrow(/witness/);
  });
  it('excludes future witness inputs and the BIP352 NUMS script-path input', () => {
    expect(buildSilentPaymentBundle('signet',block,[{...tx,vin:[{...input,prevout:{scriptpubkey:'5220'+'01'.repeat(32)}}]}]).bundle.transactions).toEqual([]);
    expect(eligibleInputKey({...input,witness:['51','c0'+'50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0']})).toBeNull();
  });
});
