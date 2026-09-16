import { expect, it, vi } from 'vitest';
import { BehaviorSubject, of } from 'rxjs';
import { AssetsService } from './assets.service';
import { environment } from '@environments/environment';

it('uses the selected Liquid native asset identity after switching networks', () => {
  const network = new BehaviorSubject('liquid');
  const state = {isBrowser:true, network:'liquid', networkChanged$:network};
  const http = {get:vi.fn(() => of({}))};
  const service = new AssetsService(http as any,state as any); let assets: any;
  service.getAssetsJson$.subscribe(value => assets = value);
  expect(assets.array[0].asset_id).toBe(environment.nativeAssetId);
  state.network='liquidtestnet'; network.next('liquidtestnet');
  expect(assets.array[0].asset_id).toBe(environment.nativeTestAssetId); expect(service.nativeAssetId).toBe(environment.nativeTestAssetId);
  expect(http.get).toHaveBeenCalledWith('/resources/assets-testnet.json');
  state.network='liquid'; network.next('liquid'); expect(assets.array[0].asset_id).toBe(environment.nativeAssetId);
});
