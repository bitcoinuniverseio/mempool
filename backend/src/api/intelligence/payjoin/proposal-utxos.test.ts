import { verifyProposalUtxos } from './proposal-utxos';
const genesis =
    '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
  tip = 'ab'.repeat(32);
const input = {
  outpoint: '11'.repeat(32) + ':0',
  value: 100000,
  script: '0014' + '22'.repeat(20),
  sequence: 0xffffffff,
};
function reader(
  output: any = {
    bestblock: tip,
    value: 0.001,
    confirmations: 6,
    coinbase: false,
    scriptPubKey: { hex: input.script },
  }
) {
  return {
    network: 'regtest',
    call: jest.fn(async (method: string) =>
      method === 'getblockhash'
        ? genesis
        : method === 'getbestblockhash'
          ? tip
          : output
    ),
  };
}
describe('Payjoin owned UTXO evidence', () => {
  it('matches exact values/scripts against a network-verified stable checkpoint', async () => {
    const result = await verifyProposalUtxos([input], reader());
    expect(result).toMatchObject({ verified: true, network: 'regtest', tip });
  });
  it.each([
    null,
    {
      bestblock: tip,
      value: 0.002,
      confirmations: 6,
      scriptPubKey: { hex: input.script },
    },
    {
      bestblock: tip,
      value: 0.001,
      confirmations: 99,
      coinbase: true,
      scriptPubKey: { hex: input.script },
    },
    {
      bestblock: tip,
      value: 0.001,
      confirmations: 6,
      scriptPubKey: { hex: '51' },
    },
  ])('rejects missing, inconsistent and immature outputs', async (output) => {
    expect((await verifyProposalUtxos([input], reader(output))).verified).toBe(
      false
    );
  });
  it('does not accept wrong network, checkpoint races or malformed numeric evidence', async () => {
    const wrong = reader();
    wrong.network = 'signet';
    await expect(verifyProposalUtxos([input], wrong)).rejects.toThrow(
      /network/
    );
    const changed = reader();
    let tips = 0;
    changed.call.mockImplementation(async (method) =>
      method === 'getblockhash'
        ? genesis
        : method === 'getbestblockhash'
          ? ++tips === 1
            ? tip
            : 'cd'.repeat(32)
          : {
              bestblock: tip,
              value: 0.001,
              confirmations: 6,
              scriptPubKey: { hex: input.script },
            }
    );
    await expect(verifyProposalUtxos([input], changed)).rejects.toThrow(
      /tip changed/
    );
    await expect(
      verifyProposalUtxos(
        [input],
        reader({
          bestblock: tip,
          value: NaN,
          confirmations: 6,
          scriptPubKey: { hex: input.script },
        })
      )
    ).rejects.toThrow(/amount/);
  });
  it('bounds the number of fresh source reads', async () => {
    await expect(
      verifyProposalUtxos(Array(101).fill(input), reader())
    ).rejects.toThrow(/bound/);
  });
});
