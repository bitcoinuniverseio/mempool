import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { PortfolioVaultService } from '../stores/vault.service';

const RECORD_TYPE = 'portfolio-share';
const API = '/api/v2/universe/portfolio-share';

interface ShareRequest {
  shareId: string;
  ownerToken: string;
  format: 'universe-portfolio-share';
  formatVersion: 1;
  nonceB64: string;
  ctB64: string;
  ttlSeconds: number;
}

export interface OwnedPortfolioShare {
  shareId: string;
  portfolioId: string;
  keyB64Url: string;
  request: ShareRequest;
  state: 'pending' | 'active' | 'revoked';
  createdAt: string;
  expiresAt: string;
}

export interface PortfolioShareSummary {
  shareId: string;
  state: OwnedPortfolioShare['state'] | 'expired';
  createdAt: string;
  expiresAt: string;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {binary += String.fromCharCode(byte);}
  return btoa(binary);
}

function capability(): string {
  return base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Owner secrets are saved in the encrypted vault; only the revoke capability reaches the API. */
@Injectable({ providedIn: 'root' })
export class PortfolioShareService {
  constructor(private readonly http: HttpClient, private readonly vault: PortfolioVaultService) {}

  unlocked(): boolean { return this.vault.isUnlocked(); }

  async create(portfolioId: string, holdings: readonly { asset: string; share: string }[], snapshotCreatedAt: string, ttlSeconds: number): Promise<string> {
    if (!this.unlocked()) {throw new Error('Unlock the portfolio vault before sharing.');}
    if (!portfolioId || holdings.length === 0 || holdings.length > 1000 || !Number.isFinite(Date.parse(snapshotCreatedAt))
      || !Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 2_592_000) {
      throw new Error('Load a portfolio report and choose a valid expiry first.');
    }
    const snapshot = {
      holdings: holdings.map(({ asset, share }) => {
        if (typeof asset !== 'string' || typeof share !== 'string' || asset.length > 200 || share.length > 100) {
          throw new Error('The report contains a row that cannot be shared.');
        }
        return { asset, share };
      }),
      createdAt: snapshotCreatedAt,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    if (bytes.length + 16 > 32_768) {throw new Error('This report is too large to share. Download it instead.');}
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt']);
    const keyB64Url = base64(keyBytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    keyBytes.fill(0);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, bytes as BufferSource);
    bytes.fill(0);
    const now = new Date().toISOString();
    const share: OwnedPortfolioShare = {
      shareId: capability(), portfolioId, keyB64Url, state: 'pending',
      createdAt: now, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      request: {
        shareId: '', ownerToken: capability(), format: 'universe-portfolio-share', formatVersion: 1,
        nonceB64: base64(nonce), ctB64: base64(new Uint8Array(ct)), ttlSeconds,
      },
    };
    share.request.shareId = share.shareId;
    // Persist before upload: an uncertain response must remain retryable and revocable.
    await this.vault.put(RECORD_TYPE, this.recordId(share.shareId), share);
    await this.publish(share);
    return share.shareId;
  }

  private recordId(shareId: string): string { return `${RECORD_TYPE}:${shareId}`; }

  private async owned(shareId: string, portfolioId: string): Promise<OwnedPortfolioShare> {
    const share = await this.vault.get<OwnedPortfolioShare>(this.recordId(shareId));
    if (!share || share.portfolioId !== portfolioId) {throw new Error('This vault has no owner capability for that report.');}
    return share;
  }

  private async publish(share: OwnedPortfolioShare): Promise<void> {
    const response = await firstValueFrom(this.http.post<{ shareId: string; expiresAt: string; createdAt: string }>(API, share.request));
    if (response.shareId !== share.shareId || !Number.isFinite(Date.parse(response.expiresAt)) || !Number.isFinite(Date.parse(response.createdAt))) {
      throw new Error('The share service returned an invalid response. Retry the pending share.');
    }
    await this.vault.put(RECORD_TYPE, this.recordId(share.shareId), {
      ...share, state: 'active', createdAt: response.createdAt, expiresAt: response.expiresAt,
    });
  }

  async retry(shareId: string, portfolioId: string): Promise<void> {
    const share = await this.owned(shareId, portfolioId);
    if (share.state !== 'pending') {throw new Error('Only a pending share can be retried.');}
    await this.publish(share);
  }

  async revoke(shareId: string, portfolioId: string): Promise<void> {
    const share = await this.owned(shareId, portfolioId);
    await firstValueFrom(this.http.delete(`${API}/${encodeURIComponent(shareId)}`, {
      headers: { Authorization: `Bearer ${share.request.ownerToken}` },
    }));
    await this.vault.put(RECORD_TYPE, this.recordId(shareId), { ...share, state: 'revoked' });
  }

  async link(shareId: string, portfolioId: string, origin: string): Promise<string> {
    const share = await this.owned(shareId, portfolioId);
    if (share.state !== 'active' || Date.parse(share.expiresAt) <= Date.now()) {throw new Error('This share is not active.');}
    return `${origin}/portfolio/share/${share.shareId}#key=${share.keyB64Url}`;
  }

  async list(portfolioId: string): Promise<PortfolioShareSummary[]> {
    const records = await this.vault.listByType(RECORD_TYPE);
    return records.map((record) => record.value as OwnedPortfolioShare)
      .filter((share) => share.portfolioId === portfolioId)
      .map((share) => ({
        shareId: share.shareId,
        state: share.state === 'active' && Date.parse(share.expiresAt) <= Date.now() ? 'expired' as const : share.state,
        createdAt: share.createdAt, expiresAt: share.expiresAt,
      })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
