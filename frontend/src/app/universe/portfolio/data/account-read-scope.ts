import { accountAddresses, type LocalPortfolio } from '../stores/portfolio-model';

export interface AccountReadTarget {
  readonly key: string;
  readonly chain: string;
  readonly network: string;
  readonly address: string;
  readonly accounts: readonly string[];
}

/** Reads public discovered addresses only; it neither discovers nor changes vault data. */
export function accountReadScope(portfolio: LocalPortfolio | null): {
  targets: AccountReadTarget[]; warnings: string[];
} {
  const targets = new Map<string, AccountReadTarget>();
  const warnings: string[] = [];
  for (const account of portfolio?.accounts ?? []) {
    const addresses = accountAddresses(account);
    if (!addresses.length) warnings.push(`${account.name}: no public addresses available for this read.`);
    if ((account.kind === 'xpub' || account.kind === 'descriptor') && account.discovery?.complete !== true) {
      warnings.push(`${account.name}: address discovery is incomplete; only discovered addresses are read.`);
    }
    for (const address of addresses) {
      const key = JSON.stringify([account.chain, account.network, address]);
      const prior = targets.get(key);
      if (prior) {
        if (!prior.accounts.includes(account.name)) targets.set(key, { ...prior, accounts: [...prior.accounts, account.name] });
      } else targets.set(key, { key, chain: account.chain, network: account.network, address, accounts: [account.name] });
    }
  }
  const all = [...targets.values()];
  if (all.length > 200) warnings.push(`Read limit: ${all.length - 200} additional addresses were not requested. Coverage is partial.`);
  return { targets: all.slice(0, 200), warnings };
}

export function matchesAccount(value: { chain: string; network: string; address: string } | null | undefined, target: AccountReadTarget): boolean {
  return !!value && value.chain === target.chain && value.network === target.network && value.address === target.address;
}
