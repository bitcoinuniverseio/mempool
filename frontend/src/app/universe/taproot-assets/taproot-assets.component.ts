import { ChangeDetectionStrategy, Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '@app/services/state.service';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription, catchError, combineLatest, of, switchMap, startWith, distinctUntilChanged } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { TaprootAssetGroup, TaprootAssetItem } from '@app/universe/universe.types';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const genesis: Record<string, string> = {
  mainnet: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f',
  signet: '00000008819873e925422c1ff0f99f7cc9bbb232af63a077a480a3633bee1ef6',
  testnet: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943',
  testnet4: '00000000da84f2bafbbc53dee25a72ae507ff4914b867c565be350b0da8bf043',
  regtest: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
};

interface TaprootViewModel {
  readonly kind: 'loading' | 'ready' | 'detail' | 'error';
  readonly assets?: TaprootAssetItem[];
  readonly groups?: TaprootAssetGroup[];
  readonly selected?: TaprootAssetItem;
}

@Component({
  selector: 'app-taproot-assets',
  templateUrl: './taproot-assets.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaprootAssetsComponent implements OnInit, OnDestroy {
  private readonly state = new BehaviorSubject<TaprootViewModel>({ kind: 'loading' });
  readonly vm$: Observable<TaprootViewModel> = this.state.asObservable();
  proofAssetId = '';
  proofData = '';
  readonly proofState = new BehaviorSubject<{kind: 'idle'|'loading'|'valid'|'invalid'|'unavailable'; message?: string; result?: any}>({kind:'idle'});
  private read?: Subscription;
  private proofRequest?: Subscription;
  private generation = 0;

  constructor(
    private api: UniverseApiService,
    private route: ActivatedRoute,
    private seo: SeoService,
    private networkState: StateService,
  ) {
    this.seo.setTitle('Taproot Assets Directory');
  }

  ngOnInit(): void {
    this.read = combineLatest([this.route.paramMap, this.networkState.networkChanged$.pipe(startWith(this.networkState.network), distinctUntilChanged())]).pipe(
      switchMap(([params]) => {
        this.state.next({kind:'loading'});
        this.invalidateProof(); this.proofData = '';
        const assetId = params.get('assetId');
        this.proofAssetId = assetId || '';
        if (assetId) {
          return this.api.getTaprootAsset$(assetId).pipe(
            switchMap((asset) => of<TaprootViewModel>({ kind: 'detail', selected: asset })),
            catchError(() => of<TaprootViewModel>({ kind: 'error' }))
          );
        }
        // No per-read fallback: a directory the source could not answer is an
        // error, not an empty directory. The two are different facts, and the
        // page has an error state for the first.
        return combineLatest([
          this.api.getTaprootAssets$(),
          this.api.getTaprootAssetGroups$(),
        ]).pipe(
          switchMap(([assetsData, groupsData]) => of<TaprootViewModel>({
            kind: 'ready',
            assets: assetsData.assets,
            groups: groupsData.groups,
          })),
          catchError(() => of<TaprootViewModel>({ kind: 'error' }))
        );
      })
    ).subscribe((vm) => this.state.next(vm));
  }

  invalidateProof(): void {
    this.generation++; this.proofRequest?.unsubscribe(); this.proofState.next({kind:'idle'});
  }
  verifyProof(): void {
    this.invalidateProof();
    const id = this.proofAssetId.trim().toLowerCase(), proof = this.proofData.replace(/[ \t\r\n]/g, '');
    if (!/^[0-9a-f]{64}$/.test(id) || !proof || this.proofData.length > 1048576 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(proof)) {
      this.proofState.next({kind:'invalid',message:'Enter a 32-byte hexadecimal asset ID and a base64 proof file of at most 1 MiB.'}); return;
    }
    const generation = this.generation, network = this.api.network;
    const selectedNetwork = network || 'mainnet';
    const binary = atob(proof);
    if (btoa(binary) !== proof) { this.proofState.next({kind:'invalid',message:'The proof base64 encoding is not in its strict form.'}); return; }
    const proofHash = bytesToHex(sha256(Uint8Array.from(binary, character => character.charCodeAt(0))));
    this.proofState.next({kind:'loading'});
    this.proofRequest = this.api.verifyTaprootProof$(id, proof).subscribe({
      next: result => {
        if (generation !== this.generation || this.api.network !== network) return;
        const anchor = result?.anchor, source = result?.source;
        if (result?.valid === true && result.stage === 'verified' && result.asset_id === id &&
            result.proof_sha256 === proofHash && result.network === selectedNetwork && source?.network === selectedNetwork &&
            !!genesis[selectedNetwork] && source.genesis_hash === genesis[selectedNetwork] &&
            /^[0-9a-f]{64}$/.test(source.block_hash || '') && source.tapd_block_hash === source.block_hash &&
            Number.isSafeInteger(source.block_height) && source.block_height >= anchor?.block_height && source.tapd_block_height === source.block_height &&
            typeof source.tapd_version === 'string' && source.tapd_version.length > 0 && Number.isFinite(Date.parse(source.observed_at)) &&
            /^[0-9a-f]{64}$/.test(anchor?.txid || '') && /^[0-9a-f]{64}$/.test(anchor?.block_hash || '') &&
            Number.isSafeInteger(anchor?.block_height) && anchor.block_height >= 0) {
          this.proofState.next({kind:'valid',result,message:'The owned verifier checked this proof and its Bitcoin block anchor.'});
        } else if (result?.valid === false && ['invalid-proof','asset-mismatch','anchor-mismatch','invalid-input'].includes(result.stage)) {
          this.proofState.next({kind:'invalid',message:result.error || 'The proof did not verify.'});
        } else this.proofState.next({kind:'unavailable',message:'No complete, matching proof verdict is available.'});
      },
      error: error => {
        if (generation !== this.generation || this.api.network !== network) return;
        this.proofState.next({kind:error?.status===400?'invalid':'unavailable',message:error?.error?.error || 'The owned proof verifier is unavailable. No proof was established.'});
      },
    });
  }
  ngOnDestroy(): void { this.invalidateProof(); this.read?.unsubscribe(); }
}
