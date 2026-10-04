// Public historical native proof observation, used only by controlled consumer tests.
import fixture from './ark-native-proof.public-fixture.json';
import { ArkBatch } from '../universe.types';
import { ArkBatchPage, ArkNativeObservation, ArkNativeProofInput, ArkNativeProofVerdict } from './ark-native-view';
export const nativeSource = fixture.selectedSource as ArkNativeObservation;
export const nativeInput = fixture.input as ArkNativeProofInput;
export const nativeVerdict = fixture.verdict as ArkNativeProofVerdict;
const timestamp = Math.floor(Date.parse(nativeSource.observedAt) / 1000);
export const nativeBatch: ArkBatch = {
  batchId:'00000000-0000-4000-8000-000000000000', operatorId:nativeSource.profile.providerId,
  anchorTxid:nativeInput.batchOutpoint.split(':')[0], rootHash:null, vtxoCount:null,
  totalAmountSats:null, expirationTimestamp:null, roundTimestamp:timestamp-120, endedAt:timestamp-60,
  status:'observed-completed', confirmation:null, nativeStage:'FINALIZATION_STAGE', source:nativeSource,
};
export const batchPage = (batches: ArkBatch[] = []): ArkBatchPage => ({batches,total:null,page:{
  after:'0',before:String(timestamp+1),limit:10,nativeObservedCount:batches.length,observedCount:batches.length,
  completeCatalogue:false,scope:'bounded-native-completed-rounds',continuation:null,
}});
