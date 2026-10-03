import { forkJoin, Observable, throwError } from 'rxjs';
import { map, switchMap, timeout } from 'rxjs/operators';
import { AddressTxSummary, ChainStats } from '@interfaces/electrs.interface';
import { ElectrsApiService } from '@app/services/electrs-api.service';
export const SUMMARY_PAGE_LIMIT = 5000;
export const SUMMARY_PAGE_DEADLINE_MS = 20000;
export interface ObservedSummaryPage { readonly anchor: string; readonly stats: ChainStats; readonly rows: AddressTxSummary[]; }
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
export function validatedSummaryRows(value: unknown, limit = SUMMARY_PAGE_LIMIT): AddressTxSummary[] {
  if (!Array.isArray(value) || value.length > limit) {throw Error('Invalid compact summary page');}
  const seen = new Set<string>(); let previous: AddressTxSummary | undefined;
  for (const row of value) {
    if (!row || !hash(row.txid) || !Number.isSafeInteger(row.value) || !Number.isSafeInteger(row.height) || row.height < 0
      || !Number.isSafeInteger(row.time) || row.time < 0 || (row.tx_position !== undefined && (!Number.isSafeInteger(row.tx_position) || row.tx_position < 0))
      || seen.has(row.txid) || (previous && (row.height > previous.height || (row.height === previous.height && previous.tx_position !== undefined && row.tx_position !== undefined && row.tx_position > previous.tx_position)))) {throw Error('Invalid or unordered compact summary evidence');}
    seen.add(row.txid); previous = row;
  }
  return value;
}
export function mergeSummaryRows(accepted: AddressTxSummary[], page: AddressTxSummary[]): AddressTxSummary[] {
  const known = new Map(accepted.map(row => [row.txid, row]));const added: AddressTxSummary[]=[];
  for (const row of validatedSummaryRows(page)) {
    const existing=known.get(row.txid);
    if (existing) { if (JSON.stringify(existing)!==JSON.stringify(row)) {throw Error('Previously accepted summary changed');} }
    else { added.push(row); }
  }
  if (accepted.length && page.length && !added.length) {throw Error('Summary cursor made no progress');}
  const last=accepted[accepted.length - 1],first=added[0];
  if(last&&first&&(first.height>last.height||(first.height===last.height&&first.tx_position!==undefined&&last.tx_position!==undefined&&first.tx_position>last.tx_position))){throw Error('Summary continuation order changed');}
  return [...accepted,...added];
}
export function exactSummaryBalance(rows: AddressTxSummary[],stats?:ChainStats): bigint {
  if (stats && ![stats.funded_txo_sum, stats.spent_txo_sum].every(value => Number.isSafeInteger(value) && value >= 0)) {throw Error('Invalid exact balance statistics');}
  const values=rows.map(row=>{ if (!Number.isSafeInteger(row.value)) {throw Error('Unsafe transaction value');} return BigInt(row.value); });
  const total=stats?BigInt(stats.funded_txo_sum)-BigInt(stats.spent_txo_sum):values.reduce((sum,value)=>sum+value,0n);
  let running=total;
  for(const value of values){if(running>BigInt(Number.MAX_SAFE_INTEGER)||running<BigInt(Number.MIN_SAFE_INTEGER)){throw Error('Balance exceeds exact chart range');}running-=value;}
  if(running>BigInt(Number.MAX_SAFE_INTEGER)||running<BigInt(Number.MIN_SAFE_INTEGER)){throw Error('Balance exceeds exact chart range');}
  return total;
}
/** Bare arrays are request-bound observations, not snapshot envelopes. The index tip is checked before/after each bounded page. */
export function readObservedSummaryPage$(api:ElectrsApiService,address:string,isPubkey:boolean,cursor?:string,anchor?:string,previousStats?:ChainStats):Observable<ObservedSummaryPage>{
 return api.getBlockTipHash$().pipe(switchMap(before=>{
  if(!hash(before)||(anchor&&before!==anchor)){return throwError(()=>Error('Index checkpoint changed; reload history'));}
  const script=(address.length===66?'21':'41')+address+'ac';
  return forkJoin({metadata:isPubkey?api.getPubKeyAddress$(address):api.getAddress$(address),rows:isPubkey?api.getScriptHashSummary$(script,cursor):api.getAddressSummary$(address,cursor)}).pipe(switchMap(({metadata,rows})=>api.getBlockTipHash$().pipe(map(after=>{
    if(after!==before){throw Error('Index checkpoint changed during read; reload history');}
    const stats=metadata.chain_stats;
    if(metadata.address!==address||!stats||![stats.tx_count,stats.funded_txo_sum,stats.spent_txo_sum].every(value=>Number.isSafeInteger(value)&&value>=0)){throw Error('Invalid address statistics');}
    if(previousStats&&[stats.tx_count,stats.funded_txo_sum,stats.spent_txo_sum].some((value,i)=>value!==[previousStats.tx_count,previousStats.funded_txo_sum,previousStats.spent_txo_sum][i])){throw Error('Address statistics changed; reload history');}
    return {anchor:before,stats,rows:validatedSummaryRows(rows)};
  }))));
 }),timeout({first:SUMMARY_PAGE_DEADLINE_MS}));
}
