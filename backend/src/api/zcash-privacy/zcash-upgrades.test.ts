import {zcashPrivacyService} from './zcash-privacy.service';
import {zcashBranchAt} from './zcash-owned-reader';
describe('network upgrade reference completeness',()=>{
  it('includes post-NU5 final upgrades and labels the NU6.3 draft specification',/** @asyncUnsafe */ async()=>{
    const reference=await zcashPrivacyService.$getUpgrades('mainnet');
    expect(reference.slice(6,10).map(row=>[row.name,row.activationHeight,row.branchId])).toEqual([
      ['NU6',2726400,'0xc8e71055'],['NU6.1',3146400,'0x4dec4df0'],['NU6.2',3364600,'0x5437f330'],['NU6.3',3428143,'0x37a5165b'],
    ]);
    expect(reference.every(row=>row.observation===false)).toBe(true);
    expect(reference[9].referenceStatus).toBe('draft-specification-settled-upgrade');
  });
  it('returns distinct testnet activation heights without borrowing mainnet dates',/** @asyncUnsafe */ async()=>{
    const reference=await zcashPrivacyService.$getUpgrades('testnet');
    expect(reference.map(row=>row.activationHeight)).toEqual([207500,280000,584000,903800,1028500,1842420,2976000,3536500,4052000,4134000,4465026]);
    expect(reference.every(row=>row.activatedAt==='')).toBe(true);
    await expect(zcashPrivacyService.$getUpgrades('signet')).rejects.toMatchObject({status:400});
  });
  it('retains the upcoming NU7 reference without inventing a mainnet activation', async () => {
    expect((await zcashPrivacyService.$getUpgrades('mainnet')).at(-1)).toMatchObject({name:'NU7', activationHeight:null, referenceStatus:'draft-upcoming', observation:false});
    expect((await zcashPrivacyService.$getUpgrades('testnet')).at(-1)).toMatchObject({name:'NU7', activationHeight:4465026, branchId:'0x77190ad9'});
  });
  it('binds current and next-block branches exactly at every configured upgrade boundary', async () => {
    for (const network of ['mainnet', 'testnet']) {
      const upgrades = await zcashPrivacyService.$getUpgrades(network);
      let previous = '00000000';
      for (const upgrade of upgrades) {
        if (upgrade.activationHeight === null) continue;
        expect(zcashBranchAt(network, upgrade.activationHeight - 1)).toBe(previous);
        expect(zcashBranchAt(network, upgrade.activationHeight)).toBe(upgrade.branchId.slice(2));
        previous = upgrade.branchId.slice(2);
      }
    }
  });
});
