/**
 * The published protocol manifest document.
 *
 * The roster itself lives in `explorer-protocol-registry.ts`. This is the
 * envelope it travels in: the roster plus enough identity for a consumer in
 * another repository to say exactly what it pinned.
 *
 * The explorer frontend records this document and gates its release on it. A
 * document with no provenance can only be compared field by field against
 * whatever is being served today, which is a check that passes on the day it
 * is written and says nothing afterwards. With a schema version, a registry
 * version, the producing repository and the commit that produced it, a
 * mismatch names both sides.
 */

import {
  EXPLORER_MANIFEST_SCHEMA_VERSION,
  EXPLORER_MANIFEST_SOURCE_REPOSITORY,
  EXPLORER_PRIMARY_STRIP,
  EXPLORER_REGISTRY_VERSION,
  explorerProtocolManifest,
  explorerProtocolManifestForChain,
} from './explorer-protocol-registry';
import { ExplorerProtocolDefinition } from '../contracts/explorer-evidence';
import {
  acceptanceRecordKey,
  indexAcceptanceRecords,
  summariseAcceptance,
  type ExplorerAcceptanceSummary,
} from './explorer-acceptance';
import { EXPLORER_ACCEPTANCE_LEDGER } from './explorer-acceptance-ledger';
import { functionalAcceptanceForScope, type SealedAcceptanceResult } from './protocol-functional-acceptance';

export interface ExplorerProtocolManifestDocument {
  /** Schema of this envelope, not of the entries inside it. */
  readonly schemaVersion: string;
  readonly registryVersion: string;
  /** The repository that owns the roster. */
  readonly sourceRepository: string;
  /** The commit that repository was built from, or `development` off a release. */
  readonly sourceSha: string;
  readonly generatedAt: string;
  /** Present only when the caller asked for a single chain. */
  readonly chain?: string;
  readonly primaryStrip: readonly string[];
  readonly protocols: readonly ExplorerProtocolDefinition[];
  /**
   * How many of the operations this document declares have been accepted end
   * to end. The denominator is the declared operations, so it is known even
   * when the ledger is empty, and a reader can never be left guessing what
   * the percentage is a percentage of.
   */
  readonly acceptance: ExplorerAcceptanceSummary;
}

export interface ExplorerProtocolManifestOptions {
  /** Restrict the roster to one chain domain. */
  readonly chain?: string;
  /** The commit this build carries. */
  readonly sourceSha: string;
  /** Injected so a recorded document is reproducible in a test. */
  readonly generatedAt?: string;
  readonly acceptanceScope?: { chain: string; network: string };
  readonly functionalAcceptance?: SealedAcceptanceResult;
}

/**
 * IMPLEMENTATION-HANDOFF [WP10] | B003 | preparation 2026-09-21
 * State: BLOCKED. The request spans 39 protocol identities and existing advanced tools.
 * Authoritative sources are available for shared Bitcoin/Ord/Runes/HTTP and several reference
 * implementations, but complete deployed-version, protocol-specific semantics and
 * supported-network proof have not been established for every authority or bespoke protocol.
 * An accessible local repository is not evidence its code is the governing specification or
 * current production revision.
 * Governing requirements: REQ-RESEARCH;
 * docs/implementation-prep/blockers-20260921/WORK-PACKAGES.json and bundled
 * research/source-register.json.
 * Prerequisites: none. 1. Retain the 39 published protocol identities while binding each
 * operation to its actual authority, governing specification revision and supported execution
 * contexts in the acceptance artifact. 2. Keep historical readable/coverage declarations
 * separate from present readability and functional proof. 3. For bespoke/unsupported-network
 * gaps, follow the exact owning repository references and record unresolved requirements
 * instead of guessing semantics or excluding broken features. 4. Extend manifest specs to
 * reject lost operation identities and mismatched acceptance bindings after WP01/WP03; run the
 * registry suite and existing exporter verification without fabricating PASS records.
 * Acceptance: Every required operation has sufficient versioned authoritative grounding and
 * executable assertions without invented semantics; all deployed dependency versions and
 * network rules are bound to the accepted evidence.
 * Rollback: No speculative migrations, protocol activation or authority replacement. Preserve
 * exact prior references and valid test evidence while resolving new gaps.
 * ANNOTATED is not implemented, verified functionality or release. Preserve existing
 * executable behavior in this preparation.
 */
export function explorerProtocolManifestDocument(
  options: ExplorerProtocolManifestOptions,
): ExplorerProtocolManifestDocument {
  const chain = options.chain?.trim().toLowerCase();
  const protocols = chain
    ? explorerProtocolManifestForChain(chain)
    : explorerProtocolManifest();
  return {
    schemaVersion: EXPLORER_MANIFEST_SCHEMA_VERSION,
    registryVersion: EXPLORER_REGISTRY_VERSION,
    sourceRepository: EXPLORER_MANIFEST_SOURCE_REPOSITORY,
    sourceSha: options.sourceSha,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(chain ? { chain } : {}),
    primaryStrip: EXPLORER_PRIMARY_STRIP,
    protocols: options.acceptanceScope && options.functionalAcceptance ? protocols.map(protocol => {
      const functionalAcceptance = functionalAcceptanceForScope(options.functionalAcceptance!, protocol, options.acceptanceScope!);
      return functionalAcceptance ? { ...protocol, functionalAcceptance } : protocol;
    }) : protocols,
    acceptance: acceptanceSummaryFor(protocols),
  };
}

/**
 * Summarises acceptance over exactly the protocols this document carries, so a
 * single chain document reports that chain's denominator rather than the whole
 * roster's.
 */
function acceptanceSummaryFor(
  protocols: readonly ExplorerProtocolDefinition[],
): ExplorerAcceptanceSummary {
  const { index, defects } = indexAcceptanceRecords(EXPLORER_ACCEPTANCE_LEDGER);
  const declared = protocols.flatMap((protocol) =>
    (protocol.readOperationDescriptors ?? []).map((operation) =>
      acceptanceRecordKey(
        protocol.id,
        operation.id,
        'default',
        protocol.chain,
        protocol.networks[0] ?? 'unknown',
      ),
    ),
  );
  return summariseAcceptance(declared, index, defects.length);
}
