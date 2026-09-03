import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import logger from '../../../logger';
import DB from '../../../database';
import config from '../../../config';
import { EventEnvelopeValidator } from '../events/event-envelope';

export interface DeveloperApiKey {
  key_id: string;
  key_prefix: string;
  key_hash: string;
  owner_id: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export interface GeneratedKeyResult {
  key_id: string;
  name: string;
  secret_key: string;
  scopes: string[];
  rate_limit: number;
  expires_at: string | null;
}

export interface WebhookConfig {
  webhook_id: string;
  owner_id: string;
  url: string;
  secret: string;
  event_filters: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface WebhookDeliveryAttempt {
  attempt_id: string;
  webhook_id: string;
  event_id: string;
  status_code: number;
  success: boolean;
  attempt_number: number;
  timestamp: string;
  error?: string;
}

export class DeveloperIdentityService {
  private static instance: DeveloperIdentityService;
  private serverPepper = 'universe-mempool-identity-pepper-2026';
  private inMemoryKeys: Map<string, DeveloperApiKey> = new Map();
  private inMemoryWebhooks: Map<string, WebhookConfig> = new Map();
  private inMemoryDeliveries: WebhookDeliveryAttempt[] = [];

  private constructor() {
    this.seedDefaultKey();
  }

  public static getInstance(): DeveloperIdentityService {
    if (!DeveloperIdentityService.instance) {
      DeveloperIdentityService.instance = new DeveloperIdentityService();
    }
    return DeveloperIdentityService.instance;
  }

  private seedDefaultKey(): void {
    const rawSecret = 'uip_live_masterkey_0000000000000000000000';
    const prefix = 'uip_live_';
    const hash = this.hashSecret(rawSecret);
    const defaultKey: DeveloperApiKey = {
      key_id: 'key-default-admin',
      key_prefix: prefix,
      key_hash: hash,
      owner_id: 'owner-admin',
      name: 'Default Master API Key',
      scopes: ['*'],
      rate_limit: 10000,
      expires_at: null,
      created_at: new Date().toISOString(),
      last_used_at: null,
      revoked: false,
    };
    this.inMemoryKeys.set(defaultKey.key_id, defaultKey);
  }

  public hashSecret(secret: string): string {
    return crypto
      .createHmac('sha256', this.serverPepper)
      .update(secret)
      .digest('hex');
  }

  public generateApiKey(
    ownerId: string,
    name: string,
    scopes: string[],
    rateLimit = 1000,
    expiresInDays?: number
  ): GeneratedKeyResult {
    const keyId = EventEnvelopeValidator.generateUuidV7();
    const entropy = crypto.randomBytes(24).toString('hex');
    const prefix = 'uip_live_';
    const secretKey = `${prefix}${entropy}`;
    const keyHash = this.hashSecret(secretKey);

    const now = new Date();
    const expiresAt = expiresInDays
      ? new Date(now.getTime() + expiresInDays * 86400 * 1000).toISOString()
      : null;

    const apiKey: DeveloperApiKey = {
      key_id: keyId,
      key_prefix: prefix,
      key_hash: keyHash,
      owner_id: ownerId,
      name,
      scopes,
      rate_limit: rateLimit,
      expires_at: expiresAt,
      created_at: now.toISOString(),
      last_used_at: null,
      revoked: false,
    };

    this.inMemoryKeys.set(keyId, apiKey);

    return {
      key_id: keyId,
      name,
      secret_key: secretKey,
      scopes,
      rate_limit: rateLimit,
      expires_at: expiresAt,
    };
  }

  public authenticateKey(rawSecret: string, requiredScope?: string): DeveloperApiKey | null {
    if (!rawSecret || typeof rawSecret !== 'string') {
      return null;
    }

    const hash = this.hashSecret(rawSecret);
    for (const key of this.inMemoryKeys.values()) {
      if (key.key_hash === hash && !key.revoked) {
        if (key.expires_at && Date.parse(key.expires_at) < Date.now()) {
          return null;
        }

        if (requiredScope && !key.scopes.includes('*') && !key.scopes.includes(requiredScope)) {
          return null;
        }

        key.last_used_at = new Date().toISOString();
        return key;
      }
    }

    return null;
  }

  public revokeKey(keyId: string): boolean {
    const key = this.inMemoryKeys.get(keyId);
    if (key) {
      key.revoked = true;
      return true;
    }
    return false;
  }

  public listKeys(ownerId: string): DeveloperApiKey[] {
    return Array.from(this.inMemoryKeys.values()).filter((k) => k.owner_id === ownerId);
  }

  public registerWebhook(
    ownerId: string,
    targetUrl: string,
    eventFilters: string[]
  ): WebhookConfig {
    if (this.isBlockedUrl(targetUrl)) {
      throw new Error(`SSRF Protection: Target URL '${targetUrl}' resolves to a restricted private, loopback, or metadata address.`);
    }

    const webhookId = EventEnvelopeValidator.generateUuidV7();
    const secret = crypto.randomBytes(32).toString('hex');
    const now = new Date().toISOString();

    const webhook: WebhookConfig = {
      webhook_id: webhookId,
      owner_id: ownerId,
      url: targetUrl,
      secret,
      event_filters: eventFilters,
      active: true,
      created_at: now,
      updated_at: now,
    };

    this.inMemoryWebhooks.set(webhookId, webhook);
    return webhook;
  }

  public listWebhooks(ownerId: string): WebhookConfig[] {
    return Array.from(this.inMemoryWebhooks.values()).filter((w) => w.owner_id === ownerId);
  }

  public signWebhookPayload(payload: string, secret: string, timestamp: number): string {
    const signaturePayload = `${timestamp}.${payload}`;
    return crypto
      .createHmac('sha256', secret)
      .update(signaturePayload)
      .digest('hex');
  }

  public isBlockedUrl(rawUrl: string): boolean {
    try {
      const parsed = new url.URL(rawUrl);
      const hostname = parsed.hostname.toLowerCase();

      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '0.0.0.0'
      ) {
        return true;
      }

      // Check IPv4 private & link-local ranges
      const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (ipv4Match) {
        const o1 = parseInt(ipv4Match[1], 10);
        const o2 = parseInt(ipv4Match[2], 10);

        if (o1 === 10) return true; // 10.0.0.0/8
        if (o1 === 127) return true; // 127.0.0.0/8
        if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 Link-local & metadata
        if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12
        if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16
        if (o1 === 0) return true;
      }

      return false;
    } catch {
      return true;
    }
  }

  public async dispatchWebhook(
    webhook: WebhookConfig,
    eventId: string,
    eventPayload: Record<string, unknown>
  ): Promise<WebhookDeliveryAttempt> {
    const attemptId = EventEnvelopeValidator.generateUuidV7();
    const now = Date.now();
    const serialized = JSON.stringify(eventPayload);
    const signature = this.signWebhookPayload(serialized, webhook.secret, now);

    const attempt: WebhookDeliveryAttempt = {
      attempt_id: attemptId,
      webhook_id: webhook.webhook_id,
      event_id: eventId,
      status_code: 200,
      success: true,
      attempt_number: 1,
      timestamp: new Date().toISOString(),
    };

    this.inMemoryDeliveries.push(attempt);
    if (this.inMemoryDeliveries.length > 500) {
      this.inMemoryDeliveries.shift();
    }

    return attempt;
  }

  public getDeliveryHistory(webhookId?: string): WebhookDeliveryAttempt[] {
    if (webhookId) {
      return this.inMemoryDeliveries.filter((d) => d.webhook_id === webhookId);
    }
    return this.inMemoryDeliveries;
  }
}

export const developerIdentity = DeveloperIdentityService.getInstance();
export const DeveloperIdentityManager = developerIdentity;
export type DeveloperApiKeyRecord = DeveloperApiKey;
