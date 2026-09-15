import { Injectable } from '@angular/core';
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
const STORAGE_KEY = 'universe.intelligence.owner-key';
export const KEY_PREFIX = 'uip_live_';

@Injectable({ providedIn: 'root' })
export class OwnerKeyService {
  private readonly subject = new BehaviorSubject<string | null>(this.read());
  public readonly key$ = this.subject.asObservable();

  private read(): string | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value && value.startsWith(KEY_PREFIX) ? value : null;
    } catch {
      return null;
    }
  }

  public get key(): string | null {
    return this.subject.value;
  }

  public set(key: string): void {
    if (!key.startsWith(KEY_PREFIX)) { return; }
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* private mode: the key lives for this page only */ }
    this.subject.next(key);
  }

  public clear(): void {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing stored */ }
    this.subject.next(null);
  }

  /** Bearer headers for an owner call; empty when no key is held. */
  public headers(): HttpHeaders {
    return this.key ? new HttpHeaders({ Authorization: `Bearer ${this.key}` }) : new HttpHeaders();
  }
}
