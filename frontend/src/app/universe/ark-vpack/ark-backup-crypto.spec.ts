import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { Subject } from 'rxjs';
import { openVpack, sealVpack, validateBackupPackage } from './ark-backup-crypto';
import { ArkBackupsComponent } from './ark-backups.component';

// Public, synthetic package: no wallet secrets or spendable outpoint.
const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const vtxo = { version: 1, vtxo_id: 'test-vtxo', network: 'signet', amount_sats: 1000,
  sequence: 0, exit_delay_blocks: 144, expires_at_height: 100000,
  script_pubkey: '5120' + pubkey.slice(2), anchor_outpoint: { txid: '11'.repeat(32), vout: 0 },
  asp_pubkey: pubkey, user_pubkey: pubkey };
const plaintext = JSON.stringify({ minimal_viable_vtxo: vtxo, extension: { memo: 'Portable Δ package' } }, null, 2) + '\n';
const passphrase = 'public test passphrase only';
let sealed: string;
beforeAll(async () => { sealed = await sealVpack(plaintext, passphrase, 'signet'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('portable authenticated V-PACK backup', () => {
  it('round trips exact package bytes and extensions', async () => {
    expect(await openVpack(sealed, passphrase, 'signet')).toBe(plaintext);
    expect(sealed).not.toContain('Portable');
    expect(sealed).not.toContain(passphrase);
  });
  it('decrypts independently using Node crypto and authenticated metadata', () => {
    const { ciphertext, ...metadata } = JSON.parse(sealed);
    const key = pbkdf2Sync(passphrase, Buffer.from(metadata.kdf.salt, 'base64'), 600000, 32, 'sha256');
    const bytes = Buffer.from(ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.cipher.nonce, 'base64'));
    decipher.setAAD(Buffer.from(JSON.stringify(metadata)));
    decipher.setAuthTag(bytes.subarray(-16));
    expect(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString()).toBe(plaintext);
    key.fill(0);
  });
  it('uses fresh random salt and nonce for every export', async () => {
    const next = JSON.parse(await sealVpack(plaintext, passphrase, 'signet'));
    const first = JSON.parse(sealed);
    expect(next.kdf.salt).not.toBe(first.kdf.salt);
    expect(next.cipher.nonce).not.toBe(first.cipher.nonce);
    expect(next.ciphertext).not.toBe(first.ciphertext);
  });
  it('rejects wrong passphrases and tampered ciphertext', async () => {
    await expect(openVpack(sealed, 'a different test password', 'signet')).rejects.toThrow('incorrect');
    const value = JSON.parse(sealed);
    const bytes = Buffer.from(value.ciphertext, 'base64'); bytes[0] ^= 1;
    value.ciphertext = bytes.toString('base64');
    await expect(openVpack(JSON.stringify(value), passphrase, 'signet')).rejects.toThrow('altered');
  });
  it('authenticates nonce metadata and enforces network after decrypting', async () => {
    const value = JSON.parse(sealed); value.cipher.nonce = Buffer.alloc(12).toString('base64');
    await expect(openVpack(JSON.stringify(value), passphrase, 'signet')).rejects.toThrow('altered');
    await expect(openVpack(sealed, passphrase, '')).rejects.toThrow('another Bitcoin network');
  });
  it.each(['version', 'kdf', 'extra', 'encoding', 'length'])('rejects unsupported or malformed %s before expensive derivation', async (kind) => {
    const value = JSON.parse(sealed);
    if (kind === 'version') value.version = 2;
    if (kind === 'kdf') value.kdf.iterations = 999999999;
    if (kind === 'extra') value.untrusted = true;
    if (kind === 'encoding') value.ciphertext = '%invalid';
    if (kind === 'length') value.ciphertext = 'AA==';
    const derive = vi.spyOn(crypto.subtle, 'deriveKey');
    await expect(openVpack(JSON.stringify(value), passphrase, 'signet')).rejects.toThrow();
    expect(derive).not.toHaveBeenCalled();
  });
  it.each([{ amount_sats: -1 }, { amount_sats: 1.1 }, { user_pubkey: 'ff'.repeat(32) }, { version: 2 }, { anchor_outpoint: {} }])('rejects invalid package structure %j', (change) => {
    expect(() => validateBackupPackage(JSON.stringify({ ...vtxo, ...change }), 'signet')).toThrow();
  });
  it('rejects short passwords and oversized/malformed input', async () => {
    await expect(sealVpack(plaintext, 'short', 'signet')).rejects.toThrow('12 to 1024');
    await expect(openVpack('x'.repeat(1500001), passphrase, 'signet')).rejects.toThrow('size limit');
    expect(() => validateBackupPackage('{', 'signet')).toThrow('malformed');
  });
});

function component() {
  const networkChanged$ = new Subject<string>();
  const state = { network: 'signet', networkChanged$ };
  return { component: new ArkBackupsComponent(state as any, { markForCheck: vi.fn() } as any), state };
}
describe('backup user actions', () => {
  it('exports a decryptable download and clears passphrases without network access', async () => {
    const { component: page } = component();
    let downloaded: Blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { downloaded = blob; return 'blob:local-backup'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => anchor, body: { appendChild: vi.fn() } });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    page.packageText = plaintext; page.passphrase = page.confirmation = passphrase;
    await page.exportBackup();
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('vpack-encrypted-backup.json');
    expect(await openVpack(await downloaded!.text(), passphrase, 'signet')).toBe(plaintext);
    expect(page.passphrase).toBe(''); expect(page.confirmation).toBe(''); expect(fetch).not.toHaveBeenCalled();
    page.ngOnDestroy();
  });
  it('restores only authenticated packages, preserves prior text after failure and clears old success', async () => {
    const { component: page } = component();
    page.envelopeText = sealed; page.passphrase = passphrase;
    await page.importBackup(); expect(page.packageText).toBe(plaintext); expect(page.status).toContain('restored');
    page.passphrase = 'wrong test passphrase';
    await page.importBackup(); expect(page.packageText).toBe(plaintext); expect(page.status).toBeNull(); expect(page.error).toContain('incorrect');
    expect(page.passphrase).toBe(''); page.ngOnDestroy();
  });
  it.each(['network', 'destroy'])('discards an in-flight decrypt after %s change', async change => {
    const { component: page, state } = component();
    page.envelopeText = sealed; page.passphrase = passphrase;
    const operation = page.importBackup();
    if (change === 'network') { state.network = ''; state.networkChanged$.next(''); } else page.ngOnDestroy();
    await operation;
    expect(page.packageText).toBe(''); expect(page.status).toBeNull(); expect(page.error).toBeNull(); expect(page.passphrase).toBe('');
    page.ngOnDestroy();
  });
});
