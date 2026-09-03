/**
 * The local portfolio model.
 *
 * Everything here is client-private: it lives in the encrypted vault and
 * never leaves the browser except through an explicit encrypted backup or
 * a client-encrypted share. Only public derived addresses are ever sent
 * to the first-party portfolio API.
 */

export type AccountSourceKind =
  | 'address'
  | 'addresses'
  | 'xpub'
  | 'descriptor'
  | 'manual';

export type ScriptKind = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr';

export interface LocalAccount {
  readonly id: string;
  readonly name: string;
  readonly chain: string;
  readonly network: string;
  readonly kind: AccountSourceKind;
  /** Public addresses (never secrets). */
  readonly addresses?: readonly string[];
  /** Watch-only extended public key material, vault-encrypted. */
  readonly xpub?: {
    readonly key: string;
    readonly script: ScriptKind;
    readonly account: number;
    readonly gapLimit: number;
    readonly branches: readonly ('external' | 'internal')[];
  };
  /** Checksummed public descriptor, vault-encrypted. */
  readonly descriptor?: {
    readonly value: string;
    readonly gapLimit: number;
  };
  readonly discovery?: {
    readonly lastIndexExternal: number;
    readonly lastIndexInternal: number;
    readonly highestUsedExternal: number;
    readonly highestUsedInternal: number;
    readonly complete: boolean;
    readonly derivedExternal?: readonly string[];
    readonly derivedInternal?: readonly string[];
  };
  readonly groupId?: string;
  readonly tags: readonly string[];
  readonly color?: string;
  readonly createdAt: string;
}

export interface LocalGroup {
  readonly id: string;
  readonly name: string;
}

export interface LocalManualEntry {
  readonly id: string;
  readonly name: string;
  readonly kind: 'asset' | 'liability';
  readonly quantity: string;
  readonly unitPrice?: string;
  readonly quoteCurrency?: string;
  readonly assetKey?: string;
  readonly location?: string;
  readonly tags: readonly string[];
  readonly note?: string;
  readonly effectiveAt: string;
  /** Manual entries are always explicitly user-entered authority. */
  readonly authority: 'user';
  readonly includedInCombined: boolean;
}

export interface PrivacySettings {
  /** Hide absolute values everywhere (percentages still allowed). */
  readonly hideValues: boolean;
  /** Additionally hide names, addresses, and identifiers. */
  readonly hideIdentifiers: boolean;
  /** Presentation mode: percentages and allocation only. */
  readonly presentationMode: boolean;
  readonly relockWhenHiddenMinutes: number;
}

export interface SnapshotPolicy {
  readonly autoAfterCompleteRefresh: boolean;
  readonly intervalMinutes: number;
}

export interface SavedView {
  readonly id: string;
  readonly section:
    | 'holdings'
    | 'activity'
    | 'utxos'
    | 'performance'
    | 'insights';
  readonly name: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly sort?: string;
  readonly group?: string;
  readonly visibleColumns?: readonly string[];
  readonly density?: 'comfortable' | 'compact';
  readonly chartMode?: string;
  readonly selectedAccounts?: readonly string[];
  readonly range?: string;
}

export interface DashboardWidgetLayout {
  readonly widget: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export type AlertRuleKind =
  | 'incoming-asset'
  | 'outgoing-asset'
  | 'internal-transfer'
  | 'confirmation'
  | 'replacement'
  | 'reorg'
  | 'quantity-change'
  | 'value-threshold'
  | 'utxo-dust'
  | 'utxo-asset-bearing'
  | 'source-degraded'
  | 'source-recovered'
  | 'price-stale'
  | 'asset-unpriced'
  | 'snapshot-completed'
  | 'discovery-new-address';

export interface AlertRule {
  readonly id: string;
  readonly kind: AlertRuleKind;
  readonly enabled: boolean;
  readonly thresholdAtomic?: string;
  readonly assetKey?: string;
  readonly accountIds?: readonly string[];
  readonly createdAt: string;
  readonly snoozedUntil?: string | null;
  readonly lastFiredAt?: string | null;
}

export interface LocalPortfolio {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly accent?: string;
  readonly accounts: readonly LocalAccount[];
  readonly groups: readonly LocalGroup[];
  readonly manualEntries: readonly LocalManualEntry[];
  readonly tags: readonly string[];
  readonly quoteCurrency: string;
  readonly privacy: PrivacySettings;
  readonly snapshotPolicy: SnapshotPolicy;
  readonly alertRules: readonly AlertRule[];
  readonly savedViews: readonly SavedView[];
  readonly dashboard: readonly DashboardWidgetLayout[];
  readonly pinnedAssetKeys: readonly string[];
  readonly hiddenAssetKeys: readonly string[];
  readonly annotations: Readonly<Record<string, {
    readonly note?: string;
    readonly category?: string;
    readonly counterpartyLabel?: string;
    readonly tags?: readonly string[];
    readonly reviewed?: boolean;
    readonly excludedFromViews?: readonly string[];
  }>>;
  readonly utxoProtections: Readonly<Record<string, {
    readonly protected: boolean;
    readonly label?: string;
    readonly tags?: readonly string[];
    readonly purpose?: string;
    readonly doNotCombineGroup?: string;
    readonly privacyGroup?: string;
    readonly reviewStatus?: 'unreviewed' | 'reviewed';
  }>>;
  readonly defaultAccountId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archived: boolean;
}

export function emptyPrivacy(): PrivacySettings {
  return {
    hideValues: false,
    hideIdentifiers: false,
    presentationMode: false,
    relockWhenHiddenMinutes: 0,
  };
}

export function emptyPortfolio(
  id: string,
  name: string,
  now: string,
): LocalPortfolio {
  return {
    id,
    name,
    accounts: [],
    groups: [],
    manualEntries: [],
    tags: [],
    quoteCurrency: 'USD',
    privacy: emptyPrivacy(),
    snapshotPolicy: { autoAfterCompleteRefresh: true, intervalMinutes: 60 },
    alertRules: [],
    savedViews: [],
    dashboard: [],
    pinnedAssetKeys: [],
    hiddenAssetKeys: [],
    annotations: {},
    utxoProtections: {},
    createdAt: now,
    updatedAt: now,
    archived: false,
  };
}

/** Duplicate-address detection across every account of a portfolio. */
export interface AddressDuplication {
  readonly address: string;
  readonly accountIds: readonly string[];
}

export function findDuplicateAddresses(
  portfolio: LocalPortfolio,
): AddressDuplication[] {
  const byAddress = new Map<string, Set<string>>();
  for (const account of portfolio.accounts) {
    for (const address of accountAddresses(account)) {
      const set = byAddress.get(address) ?? new Set<string>();
      set.add(account.id);
      byAddress.set(address, set);
    }
  }
  const duplicates: AddressDuplication[] = [];
  for (const [address, accountIds] of byAddress) {
    if (accountIds.size > 1) {
      duplicates.push({ address, accountIds: [...accountIds].sort() });
    }
  }
  return duplicates.sort((a, b) => (a.address < b.address ? -1 : 1));
}

/** Every public address an account contributes (derived or explicit). */
export function accountAddresses(account: LocalAccount): readonly string[] {
  if (account.kind === 'address' || account.kind === 'addresses') {
    return account.addresses ?? [];
  }
  if (account.kind === 'xpub') {
    const discovery = account.discovery;
    if (discovery === undefined) return [];
    return [
      ...(discovery.derivedExternal ?? []),
      ...(discovery.derivedInternal ?? []),
    ];
  }
  if (account.kind === 'descriptor') {
    const discovery = account.discovery;
    if (discovery === undefined) return [];
    return [
      ...(discovery.derivedExternal ?? []),
      ...(discovery.derivedInternal ?? []),
    ];
  }
  return [];
}

/**
 * The explicit inclusion policy the aggregation engine requires when the
 * same address appears under more than one account: the user says which
 * account counts, or the address is reported as ambiguous and never
 * silently double-counted.
 */
export type InclusionPolicy = Readonly<Record<string, string>>;

export function resolveIncludedAddresses(
  portfolio: LocalPortfolio,
  policy: InclusionPolicy,
): { readonly address: string; readonly accountId: string }[] {
  const included: { address: string; accountId: string }[] = [];
  for (const account of portfolio.accounts) {
    for (const address of accountAddresses(account)) {
      const owner = policy[address] ?? account.id;
      if (owner === account.id) included.push({ address, accountId: account.id });
    }
  }
  return included;
}

export function newLocalId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
