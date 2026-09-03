/**
 * The vault key-derivation worker.
 *
 * Passphrase stretching must never freeze the page: Argon2id (hash-wasm,
 * a maintained WASM implementation) and the PBKDF2 fallback both run
 * here. The worker derives raw key bits and returns them once; the
 * service imports them as a non-extractable WebCrypto key that is never
 * persisted, and every subsequent AES-GCM operation happens through
 * WebCrypto on envelopes stored in IndexedDB.
 */

import { argon2id } from 'hash-wasm';

export interface KdfRequest {
  readonly id: number;
  readonly op: 'argon2id' | 'pbkdf2';
  readonly passphrase: string;
  readonly saltB64: string;
  readonly memoryKiB?: number;
  readonly timeCost?: number;
  readonly parallelism?: number;
  readonly iterations?: number;
}

export interface KdfOk {
  readonly id: number;
  readonly ok: true;
  readonly bitsB64: string;
}

export interface KdfError {
  readonly id: number;
  readonly ok: false;
  readonly error: string;
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function derivePbkdf2(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** The worker scope, typed locally so the DOM lib stays the only lib. */
const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<KdfRequest>) => void): void;
  postMessage(message: KdfOk | KdfError): void;
};

workerScope.addEventListener('message', (event: MessageEvent<KdfRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      const salt = base64ToBytes(request.saltB64);
      let bits: Uint8Array;
      if (request.op === 'argon2id') {
        bits = new Uint8Array(
          await argon2id({
            password: request.passphrase,
            salt,
            parallelism: request.parallelism ?? 4,
            iterations: request.timeCost ?? 3,
            memorySize: request.memoryKiB ?? 65536,
            hashLength: 32,
            outputType: 'binary',
          }),
        );
      } else {
        bits = await derivePbkdf2(
          request.passphrase,
          salt,
          request.iterations ?? 600_000,
        );
      }
      const response: KdfOk = { id: request.id, ok: true, bitsB64: bytesToBase64(bits) };
      bits.fill(0);
      workerScope.postMessage(response);
    } catch (error) {
      const response: KdfError = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : 'The key derivation failed.',
      };
      workerScope.postMessage(response);
    }
  })();
});
