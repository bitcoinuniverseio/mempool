import {isolatedBackend,defaultMock,quietLogger} from '../../test-support/isolated-backend-helper';
describe('historical block fees without linked prices',()=>{
  const setup=()=>{
    const queries: string[]=[];
    const subject=isolatedBackend('repositories/BlocksRepository.ts',{
      '../api/bitcoin/bitcoin-api-factory':defaultMock({}),'../logger':quietLogger,
      '../config':defaultMock({MEMPOOL:{INDEXING_BLOCKS_AMOUNT:-1}}),
      '../database':defaultMock({query:async(sql: string)=>{queries.push(sql);return [[{avgHeight:1,timestamp:2000000,avgFees:5000,USD:null}]];}}),
      './CpfpRepository':defaultMock({}),
      './HashratesRepository':defaultMock({}),
      './DifficultyAdjustmentsRepository':defaultMock({}),
    }).default;
    return {subject,queries};
  };
  it('keeps blocks that have no fiat price linked',async()=>{
    const {subject,queries}=setup();
    await expect(subject.$getHistoricalBlockFees(3600,'1 MONTH')).resolves.toEqual([{avgHeight:1,timestamp:2000000,avgFees:5000,USD:null}]);
    expect(queries[0]).toMatch(/LEFT JOIN blocks_prices/);
    expect(queries[0]).toMatch(/LEFT JOIN prices/);
    expect(queries[0]).not.toMatch(/^\s*JOIN /m);
  });
});
