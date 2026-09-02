import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, Observable } from 'rxjs';

/**
 * The connection between the interface and the service worker.
 *
 * The worker decides what is stored; this service decides what the visitor is
 * told. Everything it reports is a fact about this browser: whether the
 * network is there, whether a newer build is waiting, how much stored data
 * the explorer holds. Nothing here ever reports a promise about the chain.
 *
 * Storage can be unavailable (private windows, blocked site data, server side
 * rendering), so every capability is optional and the product works when all
 * of them are absent.
 */

/** Path the worker is served from. Must match its angular.json asset mapping. */
const WORKER_URL = '/universe-service-worker.js';

export interface StorageReport {
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
}

@Injectable({ providedIn: 'root' })
export class PwaService {
  /** False only once the browser says the network is gone. Unknown is not offline. */
  private readonly offlineSubject = new BehaviorSubject<boolean>(false);
  /** A newer build is installed and waiting for this one to step aside. */
  private readonly updateSubject = new BehaviorSubject<boolean>(false);
  /** The browser offered the visitor a home screen install. */
  private readonly installSubject = new BehaviorSubject<boolean>(false);
  private readonly storageSubject = new BehaviorSubject<StorageReport>({ usageBytes: null, quotaBytes: null });

  private installEvent: any = null;
  private reloading = false;
  private hadController = false;

  readonly offline$: Observable<boolean> = this.offlineSubject.asObservable();
  readonly updateReady$: Observable<boolean> = this.updateSubject.asObservable();
  readonly installable$: Observable<boolean> = this.installSubject.asObservable();
  readonly storage$: Observable<StorageReport> = this.storageSubject.asObservable();

  constructor(@Inject(PLATFORM_ID) private platformId: object) {
    if (!isPlatformBrowser(this.platformId)) { return; }
    this.watchNetwork();
    this.watchInstallOffer();
    this.register();
  }

  /** True when this browser can have a service worker at all. */
  get supported(): boolean {
    return isPlatformBrowser(this.platformId)
      && typeof navigator !== 'undefined'
      && 'serviceWorker' in navigator;
  }

  /**
   * Registers the worker and watches for a newer one.
   *
   * A waiting worker becomes an offer the visitor accepts, never an automatic
   * reload: a visitor mid analysis is not interrupted by an update they did
   * not ask for.
   */
  private register(): void {
    if (!this.supported) { return; }
    navigator.serviceWorker.register(WORKER_URL, { type: 'module' }).then((registration) => {
      const queue = (): void => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          this.updateSubject.next(true);
        }
      };
      queue();
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            this.updateSubject.next(true);
          }
        });
      });
      navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data ?? {};
        if (data.type === 'storage') {
          this.storageSubject.next({ usageBytes: data.usage ?? null, quotaBytes: data.quota ?? null });
        }
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // The first controller is this registration claiming the page after
        // install; adopting it needs no reload. Only a later change of
        // controller is an applied update, and the visitor asked for it.
        if (!this.hadController) {
          this.hadController = true;
          return;
        }
        if (this.reloading) { return; }
        this.reloading = true;
        window.location.reload();
      });
      this.refreshStorage();
    }).catch(() => {
      // Registration refused (embedded browser, blocked origin, policy). The
      // explorer works online exactly as it did; offline is simply absent.
    });
  }

  private watchNetwork(): void {
    this.offlineSubject.next(!navigator.onLine);
    window.addEventListener('online', () => this.offlineSubject.next(false));
    window.addEventListener('offline', () => this.offlineSubject.next(true));
  }

  private watchInstallOffer(): void {
    window.addEventListener('beforeinstallprompt', (event: Event) => {
      // The browser's own banner would appear uninvited. This explorer offers
      // installation from its own surfaces instead, at the visitor's pace.
      event.preventDefault();
      this.installEvent = event;
      this.installSubject.next(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installEvent = null;
      this.installSubject.next(false);
    });
  }

  /** Applies the waiting update, at the visitor's instruction. */
  applyUpdate(): void {
    navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
  }

  /** Asks the worker and the browser for a fresh storage report. */
  refreshStorage(): void {
    navigator.serviceWorker?.controller?.postMessage({ type: 'STORAGE_ESTIMATE' });
    navigator.storage?.estimate?.().then((estimate) => {
      this.storageSubject.next({ usageBytes: estimate.usage ?? null, quotaBytes: estimate.quota ?? null });
    }).catch(() => { /* Unknown storage is reported as unknown, never as zero. */ });
  }

  /**
   * Deletes everything the service worker stored. Personal data is untouched;
   * the deletion that includes it is a separate, named action.
   */
  async clearStoredData(): Promise<boolean> {
    this.postMessage({ type: 'DELETE_CACHES' });
    if (typeof caches === 'undefined') { return false; }
    try {
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith('universe.'))
        .map((key) => caches.delete(key)));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Offers the browser's own install prompt, when it gave one.
   *
   * The result is the browser's verdict, reported as it came.
   */
  async promptInstall(): Promise<boolean> {
    const event = this.installEvent;
    if (!event) { return false; }
    this.installEvent = null;
    this.installSubject.next(false);
    event.prompt();
    try {
      const choice = await event.userChoice;
      return choice?.outcome === 'accepted';
    } catch {
      return false;
    }
  }

  /** Deletes the explorer's own local personalization data. */
  clearLocalPersonalData(): number {
    if (typeof localStorage === 'undefined') { return 0; }
    const owned: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('universe.')) { owned.push(key); }
    }
    owned.forEach((key) => localStorage.removeItem(key));
    return owned.length;
  }

  private postMessage(message: { type: string }): void {
    navigator.serviceWorker?.controller?.postMessage(message);
  }
}
