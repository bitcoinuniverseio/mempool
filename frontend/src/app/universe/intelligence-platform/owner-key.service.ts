import { Injectable, Optional } from '@angular/core';
import { StateService } from '@app/services/state.service';
import { HttpHeaders } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';

/**
 * The owner API key for the intelligence surfaces.
 *
 * The backend identifies an owner by the key that signs a request; there is
 * no user_id. The key is kept in this browser only, shown once when it is
 * created, and sent as a bearer token on every owner-scoped call. Clearing
 * it forgets the owner on this device; it does not revoke the key.
 */
/**
 * IMPLEMENTATION-HANDOFF [WP-FE-008] | D-FE-008 / DEF-BI-001 | C-FE-OWNER-NETWORK.
 * Verified: one origin-wide key is reused by headers() after a network change;
 * NetworkPrefixInterceptor sends the same bearer to Signet and root Mainnet.
 * Controlled reproduction uses a public noncredential marker, never a real key.
 * Backend WP-BI-001 independently fixes network-unscoped authentication lookup.
 * Required behavior: user scope demands network-separated credentials; governing
 * project contract is docs/api/OWNER-IDENTITY.md and owner-store network invariant.
 * 1. After WP-BI-001 defines authenticated issuing-network readback, bind stored
 *    keys to backend origin + normalized network. Subscribe to StateService scope
 *    changes and synchronously select that partition before any owner request.
 *    Keep same-network navigation working; absent partition means no bearer.
 * 2. Add an explicit validated migration for this legacy ambiguous storage key.
 *    Do not copy it into every partition or infer network from the shared prefix.
 *    Require authenticated network readback on its issuing backend; retain an
 *    unresolved legacy key locally until the user can identify its intended scope.
 * 3. Make headers/network context inseparable for each request and clear owner-
 *    specific visible state, pending subscriptions and caches on key/network
 *    changes. Coordinate IntelligenceApiService, WatchlistsComponent, Developer
 *    Platform, saved queries and UniverseApiService owner operations.
 * 4. Add proposed owner-key.service.spec.ts covering distinct Signet/Mainnet keys,
 *    switch during a request, origin isolation, reload, removal, unsupported
 *    network and legacy migration. Extend authenticated HTTP interceptor tests;
 *    assert the prior bearer is absent on the new network. Run npm test --
 *    --maxWorkers=2 src/app/universe/intelligence-platform src/app/services.
 * Acceptance: create separate isolated test identities, verify authorized own-
 *    network readback and wrong-network rejection without spending mainnet funds.
 * Rollback: preserve encrypted/exportable user recovery material and network
 *    metadata; never reintroduce origin-wide automatic credential reuse.
 */
const STORAGE_KEY = 'universe.intelligence.owner-key';
export const KEY_PREFIX = 'uip_live_';

@Injectable({ providedIn: 'root' })
export class OwnerKeyService {
  private network = 'mainnet';
  private readonly subject = new BehaviorSubject<string | null>(null);
  public readonly key$ = this.subject.asObservable();

  constructor(@Optional() private readonly state?: StateService) {
    this.network = state?.network || state?.env?.ROOT_NETWORK || 'mainnet';
    this.subject.next(this.read());
    state?.networkChanged$.subscribe(network => {
      const next = network || state.env?.ROOT_NETWORK || 'mainnet';
      if (next === this.network) return;
      this.network = next;
      this.subject.next(this.read());
    });
  }

  private storageKey(): string {
    const origin = typeof location === 'undefined' ? 'server' : location.origin;
    return STORAGE_KEY + '.v2.' + encodeURIComponent(origin) + '.' + encodeURIComponent(this.network);
  }

  private read(): string | null {
    try {
      // Legacy unscoped credentials remain stored for explicit recovery. Their
      // issuing network cannot be inferred from the shared key prefix.
      const value = localStorage.getItem(this.storageKey());
      return value && value.startsWith(KEY_PREFIX) ? value : null;
    } catch {
      return null;
    }
  }

  public get key(): string | null {
    return this.subject.value;
  }

  public set(key: string, issuingNetwork = this.network): boolean {
    if (!key.startsWith(KEY_PREFIX) || issuingNetwork !== this.network) { return false; }
    try { localStorage.setItem(this.storageKey(), key); } catch { /* private mode: the key lives for this page only */ }
    this.subject.next(key);
    return true;
  }

  public clear(): void {
    try { localStorage.removeItem(this.storageKey()); } catch { /* nothing stored */ }
    this.subject.next(null);
  }

  /** Bearer headers for an owner call; empty when no key is held. */
  public headers(): HttpHeaders {
    return this.key ? new HttpHeaders({ Authorization: `Bearer ${this.key}` }) : new HttpHeaders();
  }
}
