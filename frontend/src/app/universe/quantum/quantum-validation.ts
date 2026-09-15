import { Address, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { QuantumMigrationPlanResult, QuantumPubkeyExposure } from './quantum.service';

export function publicOutpoint(value: string): boolean {
  const parts = /^([0-9a-f]{64}):(0|[1-9][0-9]{0,9})$/i.exec(value);
  return !!parts && Number(parts[2]) <= 0xffffffff;
}

export function publicIdentifier(value: string, network = ''): boolean {
  if (publicOutpoint(value)) return true;
  if (value.length > 100 || /\s/.test(value)) return false;
  const params = ['', 'main', 'mainnet'].includes(network) ? NETWORK
    : network === 'regtest' ? { ...TEST_NETWORK, bech32: 'bcrt' }
    : ['testnet', 'testnet4', 'signet'].includes(network) ? TEST_NETWORK : null;
  try { if (!params) return false; Address(params).decode(value); return true; } catch { return false; }
}

const sats = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2100000000000000;
export function validExposure(value: QuantumPubkeyExposure, requested: string): boolean {
  return !!value && publicOutpoint(value.outpoint) && value.outpoint.toLowerCase() === `${value.txid}:${value.vout}`.toLowerCase()
    && Number.isSafeInteger(value.vout) && value.vout >= 0 && value.vout <= 0xffffffff
    && (value.first_exposed_height === undefined || Number.isSafeInteger(value.first_exposed_height) && value.first_exposed_height >= 0)
    && (!publicOutpoint(requested) || value.outpoint.toLowerCase() === requested.toLowerCase())
    && sats(value.amount_sats) && typeof value.is_exposed === 'boolean'
    && ['p2pk', 'p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr'].includes(value.script_type)
    && (value.is_exposed
      ? ['direct_pubkey_script', 'address_reuse_spend', 'keypath_taproot'].includes(value.exposure_reason)
      : value.exposure_reason === 'hash_protected' && !['p2pk', 'p2tr'].includes(value.script_type));
}

export function validPlan(value: QuantumMigrationPlanResult): boolean {
  return !!value && typeof value.plan_id === 'string' && value.plan_id.length > 0
    && sats(value.total_exposed_sats) && sats(value.estimated_migration_fee_sats)
    && Number.isSafeInteger(value.recommended_transactions_count) && value.recommended_transactions_count >= 0
    && Number.isFinite(value.post_migration_exposure_percentage)
    && value.post_migration_exposure_percentage >= 0 && value.post_migration_exposure_percentage <= 100
    && Array.isArray(value.steps) && value.steps.length <= 100
    && value.steps.every((step, index) => step && step.step_number === index + 1
      && typeof step.action === 'string' && typeof step.description === 'string');
}
