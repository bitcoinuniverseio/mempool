#!/usr/bin/env node
/**
 * Universe Explorer visual, accessibility, and cross-browser matrix.
 *
 * Drives the running application across routes, themes, viewports, and data
 * states, and records what it finds. Every API call is answered from fixtures,
 * so a difference between two runs means the interface changed, not that the
 * chain moved or that a backend went down mid-review.
 *
 * What each run asserts, per route and state:
 *   - no horizontal overflow at the viewport width
 *   - no console errors
 *   - no images that failed to load
 *   - no accessibility violations at WCAG 2.2 A/AA
 *   - no loader or skeleton still on screen once the page has settled
 *   - no chart panel that drew nothing while its fixture has data
 *   - an explicit status panel in every failure state, rather than a wait
 * and writes a screenshot for the visual comparison.
 *
 * The last three exist because a Charts page that never resolved and a Mining
 * dashboard full of skeletons passed every other check in this list and
 * shipped.
 *
 * Usage:
 *   node capture.mjs                      full matrix, chromium
 *   node capture.mjs --browser=firefox    another engine
 *   node capture.mjs --routes=home,tx     a subset while iterating
 *   node capture.mjs --states=populated   skip the failure states
 *   node capture.mjs --out=<dir>          where to write
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import * as playwright from 'playwright';
import { addressFixtures, detailFixtures, fixtures, sampleIds, stateOverrides } from './fixtures.mjs';
import { chainFixtures, chainSampleIds, chainStateOverrides, chainStateScope } from './chain-fixtures.mjs';
import { assetFixtures, assetSampleIds, savedStorageSeed } from './asset-fixtures.mjs';
import { contrastProbe } from './contrast-probe.mjs';
import { progressProbe } from './progress-probe.mjs';
import { FixtureRouter } from './fixture-router.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);

const BASE = args.base || 'http://localhost:4200';
const OUT = resolve(args.out || join(HERE, 'artifacts'));
const BROWSER = args.browser || 'chromium';

/**
 * Routes under review. `wide` marks pages that legitimately scroll a table.
 *
 * Exported so the mobile gate walks the same list against the same fixtures.
 * Two gates with two route lists is two gates that disagree about what the
 * product is, and the one nobody edits is the one that goes stale.
 */
export const ROUTES = [
  { id: 'home', path: '/', name: 'Homepage' },
  { id: 'blocks', path: '/blocks', name: 'Blocks list' },
  { id: 'block', path: `/block/${sampleIds.BLOCK_HASH}`, name: 'Block detail' },
  { id: 'mempool-block', path: '/mempool-block/0', name: 'Projected block' },
  { id: 'tx', path: `/tx/${sampleIds.TXID_A}`, name: 'Transaction detail' },
  { id: 'address', path: `/address/${sampleIds.ADDRESS}`, name: 'Address' },
  { id: 'protocols', path: '/protocols', name: 'Protocol directory' },
  { id: 'pulse', path: '/pulse', name: 'Universe Pulse' },
  { id: 'rbf', path: '/rbf', name: 'Replacements' },
  { id: 'graphs', path: '/graphs/mempool', name: 'Graphs' },
  { id: 'mining', path: '/mining', name: 'Mining dashboard' },
  { id: 'docs', path: '/docs/api', name: 'API docs' },
  { id: 'source', path: '/source', name: 'Source and licenses' },

  // The chain-domain routes. They shipped with no coverage here at all, which
  // is how eleven routes reached production without one screenshot, contrast
  // probe or unfinished-page check ever looking at them.
  { id: 'dogecoin', path: '/dogecoin', name: 'Dogecoin dashboard' },
  { id: 'dogecoin-mining', path: '/dogecoin/mining', name: 'Dogecoin mining' },
  { id: 'dogecoin-graphs', path: '/dogecoin/graphs/mempool', name: 'Dogecoin charts' },
  { id: 'dogecoin-graphs-pools', path: '/dogecoin/graphs/mining/pools', name: 'Dogecoin pool ranking' },
  { id: 'dogecoin-docs', path: '/dogecoin/docs', name: 'Dogecoin docs' },
  { id: 'dogecoin-mempool', path: '/dogecoin/mempool', name: 'Dogecoin pending' },
  { id: 'dogecoin-tx', path: `/dogecoin/tx/${chainSampleIds.DOGE_TXID}`, name: 'Dogecoin transaction' },
  { id: 'dogecoin-block', path: `/dogecoin/block/${chainSampleIds.DOGE_BLOCK}`, name: 'Dogecoin block' },
  { id: 'dogecoin-address', path: `/dogecoin/address/${chainSampleIds.DOGE_ADDRESS}`, name: 'Dogecoin address' },
  { id: 'dogecoin-protocols', path: '/dogecoin/protocols', name: 'Dogecoin protocols' },
  { id: 'dogecoin-drc20', path: '/dogecoin/protocols/drc20', name: 'DRC-20 assets' },
  // Dunes carry their own divisibility, so the pages exist to shift by it.
  { id: 'dogecoin-dunes', path: '/dogecoin/protocols/dunes', name: 'Dune catalog' },
  { id: 'dogecoin-dune', path: `/dogecoin/protocols/dunes/${chainSampleIds.DOGE_DUNE_ID}`, name: 'Dune' },
  { id: 'zcash', path: '/zcash', name: 'Zcash dashboard' },
  { id: 'zcash-mining', path: '/zcash/mining', name: 'Zcash mining' },
  { id: 'zcash-graphs', path: '/zcash/graphs/mempool', name: 'Zcash charts' },
  { id: 'zcash-graphs-hashrate', path: '/zcash/graphs/mining/hashrate-difficulty', name: 'Zcash hashrate chart' },
  { id: 'zcash-docs', path: '/zcash/docs', name: 'Zcash docs' },
  { id: 'zcash-mempool', path: '/zcash/mempool', name: 'Zcash pending' },
  { id: 'zcash-tx', path: `/zcash/tx/${chainSampleIds.ZEC_TXID}`, name: 'Zcash transaction' },
  // Zcash's block response is not Dogecoin's, and nothing here had ever asked
  // for one. It reached production as a generic field table.
  { id: 'zcash-block', path: `/zcash/block/${chainSampleIds.ZEC_BLOCK}`, name: 'Zcash block' },
  { id: 'zcash-address', path: `/zcash/address/${chainSampleIds.ZEC_ADDRESS}`, name: 'Zcash address' },
  { id: 'zcash-protocols', path: '/zcash/protocols', name: 'Zcash protocols' },
  // The ZRC-20 pages carry a ledger reported under two rulesets that are
  // allowed to disagree. They reached production as a JSON string in a cell.
  { id: 'zcash-zrc20', path: '/zcash/protocols/zrc20', name: 'ZRC-20 tokens' },
  { id: 'zcash-zrc20-token', path: `/zcash/protocols/zrc20/${chainSampleIds.ZEC_ZRC20}`, name: 'ZRC-20 token' },

  // Universe-authored routes that had no coverage either. The saved page is
  // seeded through localStorage below, because its state was never a request.
  { id: 'outpoint', path: `/outpoint/${assetSampleIds.OUTPOINT_TXID}/1`, name: 'Output' },
  { id: 'inscription', path: `/inscription/${assetSampleIds.INSCRIPTION_ID}`, name: 'Inscription' },
  { id: 'rune', path: `/rune/${assetSampleIds.RUNE_NAME}`, name: 'Rune' },
  { id: 'sat', path: `/sat/${assetSampleIds.SAT_NUMBER}`, name: 'Sat' },
  { id: 'saved', path: '/saved', name: 'Saved in this browser' },

  // The ANIMA evidence explorer. Its pages read their own authority, so the
  // capture serves them the same unavailable document every other gate sees:
  // the pages must render that state, not spin or go blank.
  { id: 'anima-protocol', path: '/protocols/anima', name: 'ANIMA protocol page' },
  { id: 'anima-transitions', path: '/anima/transitions', name: 'ANIMA transitions' },
  { id: 'anima-items', path: '/anima/items', name: 'ANIMA organisms' },

  // Fourteen Intelligence Platform routes
  { id: 'intelligence-policy-lab', path: '/tools/policy-lab', name: 'Policy Lab' },
  { id: 'intelligence-workbench', path: '/tools/workbench', name: 'Bitcoin Workbench' },
  { id: 'intelligence-verify-proof', path: '/tools/verify-proof', name: 'Verify Proof' },
  { id: 'intelligence-relay', path: '/intelligence/relay', name: 'Relay Observatory' },
  { id: 'intelligence-time-machine', path: '/intelligence/time-machine', name: 'Historical Time Machine' },
  { id: 'intelligence-mining-templates', path: '/intelligence/mining-templates', name: 'Mining Templates' },
  { id: 'intelligence-utxo-set', path: '/intelligence/utxo-set', name: 'UTXO Set' },
  { id: 'intelligence-transaction-graph', path: '/intelligence/transaction-graph', name: 'Transaction Graph' },
  { id: 'intelligence-incidents', path: '/intelligence/incidents', name: 'Network Incidents' },
  { id: 'intelligence-knowledge', path: '/intelligence/knowledge', name: 'Knowledge Registry' },
  { id: 'intelligence-developers', path: '/developers', name: 'Developer Platform' },
  { id: 'intelligence-query-studio', path: '/developers/query-studio', name: 'Query Studio' },
  { id: 'intelligence-watchlists', path: '/user/watchlists', name: 'Privacy Watchlists' },
  { id: 'intelligence-protocols', path: '/explore/protocols', name: 'Protocol Intelligence' },

  // Product 1: Global Bitcoin Network Observatory
  { id: 'global-network', path: '/network/global', name: 'Global Network Observatory' },
  { id: 'global-network-nodes', path: '/network/global/nodes', name: 'Global Network Nodes' },
  { id: 'global-network-node-detail', path: '/network/global/node/node-ashburn-01', name: 'Global Network Node Detail' },
  { id: 'global-network-snapshots', path: '/network/global/snapshots', name: 'Global Network Snapshots' },
  { id: 'global-network-seeds', path: '/network/global/seeds', name: 'Global Network Seeds' },
  { id: 'global-network-self-check', path: '/network/global/self-check', name: 'Global Network Self Check' },

  // Product 2: Lightning Reliability, Liquidity, and Channel Lifecycle Center
  { id: 'lightning-reliability', path: '/lightning/reliability', name: 'Lightning Reliability' },
  { id: 'lightning-liquidity', path: '/lightning/liquidity', name: 'Lightning Liquidity' },
  { id: 'lightning-lsp', path: '/lightning/lsp', name: 'Lightning LSP Directory' },
  { id: 'lightning-node-reliability', path: '/lightning/node/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798/reliability', name: 'Lightning Node Reliability' },
  { id: 'lightning-channel-lifecycle', path: '/lightning/channel/860000x120x1/lifecycle', name: 'Lightning Channel Lifecycle' },
  { id: 'lightning-closure-forensics', path: `/lightning/closure/${sampleIds.TXID_A}`, name: 'Lightning Closure Forensics' },

  // Product 3: Silent Payments Center
  { id: 'silent-payments', path: '/payments/silent', name: 'Silent Payments Center' },
  { id: 'silent-payments-scan', path: '/payments/silent/scan', name: 'Silent Payments Scanner' },
  { id: 'silent-payments-address', path: '/payments/silent/address', name: 'Silent Payments Address Tools' },
  { id: 'silent-payments-psbt', path: '/payments/silent/psbt', name: 'Silent Payments PSBT Inspector' },
  { id: 'silent-payments-coverage', path: '/payments/silent/coverage', name: 'Silent Payments Ecosystem Coverage' },

  // Product 4: Collaborative Payments and Payjoin Center
  { id: 'payjoin', path: '/payments/payjoin', name: 'Collaborative Payments Center' },
  { id: 'payjoin-analyze', path: '/payments/payjoin/analyze', name: 'Payjoin Proposal Analyzer' },
  { id: 'payjoin-directory', path: '/payments/payjoin/directory', name: 'Payjoin Server Directory' },
  { id: 'payjoin-compatibility', path: '/payments/payjoin/compatibility', name: 'Payjoin Compatibility Matrix' },
  { id: 'payjoin-playground', path: '/payments/payjoin/playground', name: 'Payjoin Regtest Playground' },

  // Product 5: Ecash and Federation Observatory
  { id: 'ecash', path: '/ecash', name: 'Ecash Observatory' },
  { id: 'ecash-cashu', path: '/ecash/cashu', name: 'Cashu Mint Catalog' },
  { id: 'ecash-cashu-detail', path: '/ecash/cashu/mint-cashu-legend', name: 'Cashu Mint Detail' },
  { id: 'ecash-fedimint', path: '/ecash/fedimint', name: 'Fedimint Directory' },
  { id: 'ecash-fedimint-detail', path: '/ecash/fedimint/fed-global-civic', name: 'Fedimint Federation Detail' },
  { id: 'ecash-inspect', path: '/ecash/inspect', name: 'Ecash Token Inspector' },

  // Product 6: Consensus Upgrade, Covenant, and Vault Lab
  { id: 'consensus-proposals', path: '/labs/consensus', name: 'Consensus Proposals Lab' },
  { id: 'consensus-proposal-detail', path: '/labs/consensus/bip-0119', name: 'Consensus Proposal Detail' },
  { id: 'consensus-compare', path: '/labs/consensus/compare', name: 'Consensus Proposals Compare' },
  { id: 'vaults-overview', path: '/labs/vaults', name: 'Vault Architecture Lab' },
  { id: 'vaults-designer', path: '/labs/vaults/designer', name: 'Visual Vault Designer' },
  { id: 'vaults-simulate', path: '/labs/vaults/simulate', name: 'Vault Transaction Simulator' },

  // Product 7: Quantum Exposure and Migration Readiness Center
  { id: 'quantum-overview', path: '/intelligence/quantum', name: 'Quantum Readiness Overview' },
  { id: 'quantum-exposure', path: '/intelligence/quantum/exposure', name: 'Quantum Script Cohorts' },
  { id: 'quantum-history', path: '/intelligence/quantum/history', name: 'Quantum Reveal Timeline' },
  { id: 'quantum-audit', path: '/intelligence/quantum/audit', name: 'Quantum Public Key Audit' },
  { id: 'quantum-migration', path: '/intelligence/quantum/migration', name: 'Quantum Migration Planner' },

  // Product 8: Blockspace Demand and Transaction Semantics Terminal
  { id: 'blockspace-overview', path: '/intelligence/blockspace', name: 'Blockspace Semantics Overview' },
  { id: 'blockspace-composition', path: '/intelligence/blockspace/composition', name: 'Blockspace Composition Timeseries' },
  { id: 'blockspace-regimes', path: '/intelligence/blockspace/regimes', name: 'Blockspace Fee Regimes' },
  { id: 'blockspace-compare', path: '/intelligence/blockspace/compare', name: 'Blockspace Regime Compare' },
  { id: 'blockspace-taxonomy', path: '/intelligence/blockspace/taxonomy', name: 'Blockspace Taxonomy Catalog' },

  // Product 9: Reserves and Solvency Verification Center
  { id: 'reserves-overview', path: '/intelligence/reserves', name: 'Proof of Reserves Overview' },
  { id: 'reserves-providers', path: '/intelligence/reserves/providers', name: 'Reserve Providers Directory' },
  { id: 'reserves-provider-detail', path: '/intelligence/reserves/provider/prov-bitreserve-custody', name: 'Reserve Provider Detail' },
  { id: 'reserves-snapshot-detail', path: '/intelligence/reserves/snapshot/snap-860395-bitreserve', name: 'Reserve Snapshot Detail' },
  { id: 'reserves-verify', path: '/intelligence/reserves/verify', name: 'Reserves & Solvency Verifier' },

  // Emerging Product 1: Discreet Log Contract and Oracle Verification Center
  { id: 'dlc-overview', path: '/contracts/dlc', name: 'DLC Overview' },
  { id: 'dlc-oracles', path: '/contracts/dlc/oracles', name: 'DLC Oracles' },
  { id: 'dlc-oracle-detail', path: '/contracts/dlc/oracle/oracle-kormir-rates', name: 'DLC Oracle Detail' },
  { id: 'dlc-events', path: '/contracts/dlc/events', name: 'DLC Events' },
  { id: 'dlc-event-detail', path: '/contracts/dlc/event/event-btc-usd-2026-q4', name: 'DLC Event Detail' },
  { id: 'dlc-inspect', path: '/contracts/dlc/inspect', name: 'DLC Contract Inspector' },
  { id: 'dlc-simulate', path: '/contracts/dlc/simulate', name: 'DLC Regtest Simulator' },

  // Emerging Product 2: Simplicity Contract Explorer and Formal Verification Workbench
  { id: 'simplicity-overview', path: '/liquid/simplicity', name: 'Simplicity Overview' },
  { id: 'simplicity-contracts', path: '/liquid/simplicity/contracts', name: 'Simplicity Contracts' },
  { id: 'simplicity-tx', path: `/liquid/simplicity/tx/${sampleIds.TXID_A}`, name: 'Simplicity Transaction Execution' },
  { id: 'simplicity-program-detail', path: '/liquid/simplicity/program/sim-multisig-v1', name: 'Simplicity Program Detail' },
  { id: 'simplicity-tools', path: '/tools/simplicity', name: 'Simplicity Compiler Workbench' },
  { id: 'simplicity-verify', path: '/tools/simplicity/verify', name: 'Simplicity Formal Proof Verifier' },

  // Emerging Product 3: Statechain, CoinSwap, and Off-Chain UTXO Recovery Center
  { id: 'offchain-utxo', path: '/offchain/utxo', name: 'Off-Chain UTXO Overview' },
  { id: 'offchain-statechains', path: '/offchain/statechains', name: 'Statechains Overview' },
  { id: 'offchain-statechains-operators', path: '/offchain/statechains/operators', name: 'Statechain Operators' },
  { id: 'offchain-statechain-operator-detail', path: '/offchain/statechains/operator/sc-mercury-alpha', name: 'Statechain Operator Detail' },
  { id: 'offchain-statechains-verify', path: '/offchain/statechains/verify', name: 'Statechain Transfer Verifier' },
  { id: 'offchain-coinswap', path: '/offchain/coinswap', name: 'CoinSwap Overview' },
  { id: 'offchain-coinswap-inspect', path: '/offchain/coinswap/inspect', name: 'CoinSwap Package Inspector' },
  { id: 'offchain-recovery', path: '/offchain/recovery', name: 'Off-Chain Recovery Planner' },

  // Emerging Product 4: Compact Filter and Light-Client Verification Center
  { id: 'light-client-overview', path: '/network/light-client', name: 'Light-Client Overview' },
  { id: 'light-client-providers', path: '/network/light-client/providers', name: 'Light-Client Providers' },
  { id: 'light-client-provider-detail', path: '/network/light-client/provider/node-ashburn-01', name: 'Light-Client Provider Detail' },
  { id: 'light-client-filters', path: '/network/light-client/filters', name: 'BIP158 Filter Explorer' },
  { id: 'light-client-verify', path: '/network/light-client/verify', name: 'Filter Header Verifier' },
  { id: 'light-client-scan', path: '/network/light-client/scan', name: 'Local Descriptor Scanner' },
  { id: 'light-client-privacy', path: '/network/light-client/privacy', name: 'Light-Client Privacy Controls' },

  // Emerging Product 5: AssumeUTXO and Node Bootstrap Snapshot Center
  { id: 'bootstrap-overview', path: '/node/bootstrap', name: 'AssumeUTXO Bootstrap Overview' },
  { id: 'bootstrap-snapshots', path: '/node/bootstrap/snapshots', name: 'AssumeUTXO Snapshots' },
  { id: 'bootstrap-snapshot-detail', path: '/node/bootstrap/snapshot/840000', name: 'AssumeUTXO Snapshot Detail' },
  { id: 'bootstrap-verify', path: '/node/bootstrap/verify', name: 'AssumeUTXO Integrity Verifier' },
  { id: 'bootstrap-planner', path: '/node/bootstrap/planner', name: 'AssumeUTXO Bootstrap Planner' },
  { id: 'bootstrap-chainstates', path: '/node/bootstrap/chainstates', name: 'Dual-Chainstate Observatory' },

  // Emerging Product 6: MuSig2, Multisig Setup, and Wallet Policy Interoperability Center
  { id: 'multiparty-overview', path: '/tools/multiparty', name: 'Multiparty Coordination Overview' },
  { id: 'multiparty-musig2', path: '/tools/multiparty/musig2', name: 'MuSig2 Coordinator' },
  { id: 'multiparty-musig2-session', path: '/tools/multiparty/musig2/session/session-musig2-cold-01', name: 'MuSig2 Session Detail' },
  { id: 'multiparty-bsms', path: '/tools/multiparty/bsms', name: 'BSMS Multisig Setup' },
  { id: 'multiparty-policies', path: '/tools/multiparty/policies', name: 'Wallet Policy Interoperability' },
  { id: 'multiparty-labels', path: '/tools/multiparty/labels', name: 'Wallet Labels Interoperability' },
  { id: 'multiparty-compatibility', path: '/tools/multiparty/compatibility', name: 'Hardware Compatibility Matrix' },

  // Emerging Product 7: Decentralized Mining Sharechain and Template-Autonomy Observatory
  { id: 'mining-decentralized-overview', path: '/mining/decentralized', name: 'Decentralized Mining Overview' },
  { id: 'mining-decentralized-datum', path: '/mining/decentralized/datum', name: 'DATUM Observatory' },
  { id: 'mining-decentralized-p2pool', path: '/mining/decentralized/p2pool', name: 'P2Pool v2 Observatory' },
  { id: 'mining-decentralized-braidpool', path: '/mining/decentralized/braidpool', name: 'Braidpool DAG Observatory' },
  { id: 'mining-decentralized-share-detail', path: '/mining/decentralized/share/share-datum-881290', name: 'Sharechain Share Detail' },
  { id: 'mining-decentralized-compare', path: '/mining/decentralized/compare', name: 'Template Autonomy Comparison' },

  // Emerging Product 8: Nostr and Lightning Payment Connectivity Center
  { id: 'payments-overview', path: '/payments', name: 'Payment Connectivity Overview' },
  { id: 'payments-nwc', path: '/payments/nwc', name: 'NWC Relays Directory' },
  { id: 'payments-nwc-inspect', path: '/payments/nwc/inspect', name: 'NWC URI Inspector' },
  { id: 'payments-nwc-compatibility', path: '/payments/nwc/compatibility', name: 'NWC Protocol Standards' },
  { id: 'payments-lnurl', path: '/payments/lnurl', name: 'LNURL Specifications' },
  { id: 'payments-lightning-address', path: '/payments/lightning-address', name: 'Lightning Address Resolution' },
  { id: 'payments-zaps', path: '/payments/zaps', name: 'NIP-57 Zap Verifier' },

  // Emerging Product 9: Bitcoin Staking, Finality, and Slashing Evidence Observatory
  { id: 'staking-overview', path: '/protocols/bitcoin-staking', name: 'Bitcoin Staking Overview' },
  { id: 'staking-delegations', path: '/protocols/bitcoin-staking/delegations', name: 'Staking Delegations' },
  { id: 'staking-delegation-detail', path: '/protocols/bitcoin-staking/delegation/del-882001-allnodes', name: 'Staking Delegation Detail' },
  { id: 'staking-finality-providers', path: '/protocols/bitcoin-staking/finality-providers', name: 'Finality Providers Directory' },
  { id: 'staking-finality-provider-detail', path: '/protocols/bitcoin-staking/finality-provider/fp-allnodes-01', name: 'Finality Provider Detail' },
  { id: 'staking-parameters', path: '/protocols/bitcoin-staking/parameters', name: 'Staking Protocol Parameters' },
  { id: 'staking-evidence', path: '/protocols/bitcoin-staking/evidence', name: 'EOTS Slashing Evidence' },
  { id: 'staking-reconciliation', path: '/protocols/bitcoin-staking/reconciliation', name: 'Cross-Chain PoS Reconciliation' },

  // Frontier Product 1: Cross-Layer Atomic Swap and Submarine Swap Verification Center
  { id: 'swaps', path: '/swaps', name: 'Swaps Overview' },
  { id: 'swaps-submarine', path: '/swaps/submarine', name: 'Submarine Swaps' },
  { id: 'swaps-reverse', path: '/swaps/reverse', name: 'Reverse Swaps' },
  { id: 'swaps-chain', path: '/swaps/chain', name: 'Chain Swaps' },
  { id: 'swaps-providers', path: '/swaps/providers', name: 'Swap Providers' },
  { id: 'swaps-provider-detail', path: '/swaps/provider/boltz-exchange', name: 'Swap Provider Detail' },
  { id: 'swaps-inspect', path: '/swaps/inspect', name: 'Swap Script Inspector' },
  { id: 'swaps-recover', path: '/swaps/recover', name: 'Swap Recovery' },
  { id: 'swaps-simulate', path: '/swaps/simulate', name: 'Swap Simulator' },

  // Frontier Product 2: Ark V-PACK, VTXO Portability, and Unilateral Exit Center
  { id: 'ark-vpack', path: '/ark/vpack', name: 'Ark V-PACK Overview' },
  { id: 'ark-vpack-verify', path: '/ark/vpack/verify', name: 'Ark V-PACK Verifier' },
  { id: 'ark-vpack-translate', path: '/ark/vpack/translate', name: 'Ark V-PACK Translator' },
  { id: 'ark-vtxo-detail', path: '/ark/vtxo/vtxo-864190-001', name: 'VTXO Detail' },
  { id: 'ark-backups', path: '/ark/backups', name: 'Ark Backup Retention' },
  { id: 'ark-exit', path: '/ark/exit', name: 'Ark Unilateral Exit' },
  { id: 'ark-exit-simulate', path: '/ark/exit/simulate', name: 'Ark Exit Cost Simulator' },
  { id: 'ark-providers', path: '/ark/providers', name: 'Ark ASP Directory' },

  // Frontier Product 3: Lightning HTLC/PTLC Congestion and Jamming Resilience Center
  { id: 'lightning-resilience', path: '/lightning/resilience', name: 'Lightning Resilience' },
  { id: 'lightning-resilience-htlcs', path: '/lightning/resilience/htlcs', name: 'Lightning HTLC Slots' },
  { id: 'lightning-resilience-onion', path: '/lightning/resilience/onion-messages', name: 'Lightning Onion Messages' },
  { id: 'lightning-resilience-channel-detail', path: '/lightning/resilience/channel/864190x304x2', name: 'Lightning Resilience Channel Detail' },
  { id: 'lightning-resilience-node-detail', path: '/lightning/resilience/node/0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', name: 'Lightning Resilience Node Detail' },
  { id: 'lightning-resilience-simulate', path: '/lightning/resilience/simulate', name: 'Lightning Jamming Simulator' },
  { id: 'lightning-resilience-mitigations', path: '/lightning/resilience/mitigations', name: 'Lightning Anti-Jamming Mitigations' },

  // Frontier Product 4: Block Propagation, Compact-Block Reconstruction, and Fork-Race Observatory
  { id: 'block-propagation', path: '/network/blocks', name: 'Block Propagation Overview' },
  { id: 'block-propagation-live', path: '/network/blocks/live', name: 'Block Propagation Live' },
  { id: 'block-propagation-block-detail', path: '/network/blocks/00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3', name: 'Block Propagation Detail' },
  { id: 'block-propagation-compact-blocks', path: '/network/compact-blocks', name: 'BIP152 Compact Blocks' },
  { id: 'block-propagation-fork-races', path: '/network/fork-races', name: 'Fork Races Observatory' },
  { id: 'block-propagation-race-detail', path: '/network/fork-races/race-863920', name: 'Fork Race Detail' },
  { id: 'block-propagation-stale-tips', path: '/network/stale-tips', name: 'Stale Tips Observatory' },
  { id: 'block-propagation-fibre', path: '/network/fibre', name: 'FIBRE Relay Network' },

  // Frontier Product 5: Private Transaction Submission, Accelerator, and Ordering Evidence Center
  { id: 'private-submission', path: '/mempool/submission', name: 'Submission Overview' },
  { id: 'private-submission-broadcast', path: '/mempool/private-broadcast', name: 'Private Miner Broadcast' },
  { id: 'private-submission-accelerators', path: '/mempool/accelerators', name: 'Accelerator Directory' },
  { id: 'private-submission-accelerator-detail', path: '/mempool/accelerator/mempool-accelerate', name: 'Accelerator Provider Detail' },
  { id: 'private-submission-receipts', path: '/mempool/receipts', name: 'Accelerator Receipts Verifier' },
  { id: 'private-submission-ordering', path: '/intelligence/ordering', name: 'Ordering Evidence' },
  { id: 'private-submission-ordering-tx', path: '/intelligence/ordering/tx/9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678', name: 'Ordering Transaction Proof' },
  { id: 'private-submission-ordering-block', path: '/intelligence/ordering/block/00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3', name: 'Ordering Block Audit' },

  // Frontier Product 6: OpenTimestamps and Bitcoin Proof-of-Publication Center
  { id: 'opentimestamps', path: '/tools/timestamp', name: 'OpenTimestamps Overview' },
  { id: 'opentimestamps-stamp', path: '/tools/timestamp/stamp', name: 'OpenTimestamps Stamp Document' },
  { id: 'opentimestamps-verify', path: '/tools/timestamp/verify', name: 'OpenTimestamps Verify Proof' },
  { id: 'opentimestamps-inspect', path: '/tools/timestamp/inspect', name: 'OpenTimestamps Inspector' },
  { id: 'opentimestamps-git', path: '/tools/timestamp/git', name: 'OpenTimestamps Git Attestation' },
  { id: 'opentimestamps-intelligence', path: '/intelligence/timestamps', name: 'OpenTimestamps Intelligence' },
  { id: 'opentimestamps-calendars', path: '/intelligence/timestamps/calendars', name: 'OpenTimestamps Calendar Servers' },
  { id: 'opentimestamps-batches', path: '/intelligence/timestamps/batches', name: 'OpenTimestamps Anchored Batches' },

  // Frontier Product 7: Bitcoin Consensus Conformance, Differential Validation, and Formal Verification Center
  { id: 'consensus-conformance', path: '/labs/consensus/conformance', name: 'Consensus Conformance Overview' },
  { id: 'consensus-conformance-differential', path: '/labs/consensus/differential', name: 'Differential Fuzzing Matrix' },
  { id: 'consensus-conformance-cases', path: '/labs/consensus/cases', name: 'Consensus Discrepancy Cases' },
  { id: 'consensus-conformance-case-detail', path: '/labs/consensus/case/case-div-tapscript-sigops-01', name: 'Consensus Discrepancy Detail' },
  { id: 'consensus-conformance-formal', path: '/labs/consensus/formal', name: 'Formal Verification Proofs' },
  { id: 'consensus-conformance-specifications', path: '/labs/consensus/specifications', name: 'Consensus BIP Specifications' },
  { id: 'consensus-conformance-corpora', path: '/labs/consensus/corpora', name: 'Fuzzing Corpora Catalog' },

  // Frontier Product 8: Node Software Security, Advisory, and Upgrade Readiness Center
  { id: 'node-security', path: '/node/security', name: 'Node Security Overview' },
  { id: 'node-security-fleet', path: '/node/security/fleet', name: 'Node Fleet Security' },
  { id: 'node-security-node-detail', path: '/node/security/node/node-prod-eu-01', name: 'Node Security Detail' },
  { id: 'node-security-advisories', path: '/node/security/advisories', name: 'Security Advisories Database' },
  { id: 'node-security-advisory-detail', path: '/node/security/advisory/ADV-2026-001', name: 'Security Advisory Detail' },
  { id: 'node-security-releases', path: '/node/security/releases', name: 'Node Release Lifecycle' },
  { id: 'node-security-artifacts', path: '/node/security/artifacts', name: 'Guix Reproducible Artifacts' },
  { id: 'node-security-upgrade', path: '/node/security/upgrade', name: 'Node Upgrade Planner' },
  { id: 'node-security-configuration', path: '/node/security/configuration', name: 'Hardened Config Generator' },

  // Frontier Product 9: Collaborative Transaction and CoinJoin Protocol Verification Center
  { id: 'collaborative-privacy', path: '/privacy/collaborative', name: 'Collaborative Privacy Overview' },
  { id: 'collaborative-privacy-inspect', path: '/privacy/collaborative/inspect', name: 'Collaborative Tx Inspector' },
  { id: 'collaborative-privacy-wabisabi', path: '/privacy/collaborative/wabisabi', name: 'WabiSabi Protocol Intelligence' },
  { id: 'collaborative-privacy-joinmarket', path: '/privacy/collaborative/joinmarket', name: 'JoinMarket Protocol Intelligence' },
  { id: 'collaborative-privacy-whirlpool', path: '/privacy/collaborative/whirlpool', name: 'Whirlpool Protocol Intelligence' },
  { id: 'collaborative-privacy-coordinators', path: '/privacy/collaborative/coordinators', name: 'CoinJoin Coordinator Registry' },
  { id: 'collaborative-privacy-round-detail', path: '/privacy/collaborative/round/rnd-ws-864198-01', name: 'CoinJoin Round Detail' },
  { id: 'collaborative-privacy-fidelity-bonds', path: '/privacy/collaborative/fidelity-bonds', name: 'Fidelity Bonds Observatory' },

  // The chain switcher, open. Nothing here had ever opened a menu, so the one
  // surface that decides which chain a visitor is looking at was measured only
  // while closed. It was collapsed: the header's own `.dropdown-item` rule,
  // written for the network rows, outranked the switcher's two-column grid and
  // ran each chain's name, state and detail into a single line.
  {
    id: 'chain-menu',
    path: '/',
    name: 'Chain switcher, open',
    open: '.chain-toggle',
    // An open menu deliberately covers what is under it. axe reads a covered
    // control as a target too small to hit, and at 320 and 375 it reads the
    // search field behind this menu that way. That is a real measurement of a
    // state that is not the one the rule is about: the field is not a target
    // while a dismissible menu is over it, and the same field at the same
    // widths passes on the `home` route, which is this path with the menu
    // closed and is measured in full in every run.
    //
    // So obscuring findings on this route are reported on their own line
    // rather than counted, and every other rule still fails the run. The line
    // prints what was obscured, because a rule that is quietly not counted is
    // a rule nobody sees again.
    overlayObscures: true,
  },
];

const VIEWPORTS = [
  { id: '320', width: 320, height: 900 },
  { id: '375', width: 375, height: 900 },
  { id: '768', width: 768, height: 1024 },
  { id: '1024', width: 1024, height: 900 },
  { id: '1280', width: 1280, height: 900 },
  { id: '1440', width: 1440, height: 900 },
  { id: '1920', width: 1920, height: 1080 },
];

const THEMES = ['default', 'dark', 'contrast'];

/**
 * How long a page may take to stop showing loaders before the run calls it
 * unfinished. Generous, because a loaded CI machine is slower than a laptop
 * and the thing being measured is whether the page ever finishes, not how
 * fast the machine is.
 */
const SETTLE_DEADLINE_MS = 15_000;

/**
 * A failure fixture has nothing to fetch, so it should reach its terminal
 * state almost at once. Waiting the full budget on every one of those turned
 * a matrix that used to take minutes into one that could not finish.
 */
const FAILURE_SETTLE_DEADLINE_MS = 4_000;

const ALL_OVERRIDES = { ...stateOverrides, ...chainStateOverrides };

const STATES = ['populated', ...Object.keys(ALL_OVERRIDES)];

/** True when a state is worth measuring on a route. Unscoped states run everywhere. */
function stateApplies(state, routeId) {
  const scope = chainStateScope[state];
  return !scope || scope.some((prefix) => routeId === prefix || routeId.startsWith(`${prefix}-`));
}

function pick(list, key, idKey = 'id') {
  if (!args[key]) return list;
  const wanted = String(args[key]).split(',');
  return list.filter((entry) => wanted.includes(typeof entry === 'string' ? entry : entry[idKey]));
}

export async function installFixtures(context, state, routeId = 'unknown', scenarioId = 'default') {
  const router = new FixtureRouter({ routeId, scenarioId, state });
  context._fixtureRouter = router;
  context._unmatchedFixtureErrors = [];

  await context.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const query = Object.fromEntries(url.searchParams.entries());
    const method = req.method();
    const body = req.postData();

    const handled = router.handle({
      method,
      pathname: url.pathname,
      query,
      body,
    });

    if (handled.action === 'hang') {
      return; // never fulfil: hold loading state
    }

    if (handled.action === 'fulfill') {
      return route.fulfill({
        status: handled.status,
        contentType: handled.contentType,
        body: typeof handled.response === 'string' ? handled.response : JSON.stringify(handled.response),
      });
    }

    // Fail closed: record failure prominently and return 500 fixture-missing error
    context._unmatchedFixtureErrors.push(`Unmatched ${method} ${url.pathname} for route ${router.currentRouteId}`);
    return route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify(handled.response),
    });
  });

  // Most live surfaces on this product are fed by the socket, not by REST, so
  // a screenshot with the socket cut is a screenshot of skeletons. Answer it
  // from the same fixtures instead: the client sends {action:'want'}, and one
  // push carries the whole initial state.
  const overrides = ALL_OVERRIDES[state] ?? {};
  const down = state === 'chain-down' || overrides['**']?.hang;
  await context.routeWebSocket('**/api/v1/ws', (ws) => {
    if (down) return; // connected but silent: the reconnecting and loading states
    const push = () => ws.send(JSON.stringify(socketState(state)));
    ws.onMessage((raw) => {
      push();
      // The Lens only draws once it is handed the contents of the block it is
      // tracking. Without this the product's signature view is a grey square in
      // every screenshot, which is the one thing a design review cannot skip.
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      const index = message?.['track-mempool-block'];
      if (typeof index === 'number' && index >= 0) {
        ws.send(JSON.stringify({
          'projected-block-transactions': {
            index,
            sequence: 1,
            blockTransactions: projectedBlockTransactions(),
          },
        }));
      }
    });
    push();
  });

  // The chain pages open their own socket, and nothing answered it: every
  // chain screenshot carried a failed-handshake console error, which is noise
  // that would hide a real one, and the live path itself went unexercised.
  //
  // The client subscribes to three channels at once and expects one envelope
  // per channel. Sequence numbers stay fixed so a rerun produces the same
  // screenshot; the client only uses them to resume after a drop.
  await context.routeWebSocket('**/api/v1/universe/ws', (ws) => {
    if (down) return; // connected but silent, which is the reconnecting state
    ws.onMessage((raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message?.type !== 'subscribe' || !Array.isArray(message.subscriptions)) {
        return;
      }
      for (const subscription of message.subscriptions) {
        const chain = subscription?.chain;
        const channel = subscription?.channel;
        if (!chain || !channel) continue;
        ws.send(JSON.stringify({
          schemaVersion: 'universe-websocket-v1',
          chain,
          network: 'mainnet',
          channel,
          snapshotId: 'snap-4812',
          sequenceAtomic: '148201',
          observedAt: '2026-08-29T05:03:00.000Z',
          tip: chainFixtures[`/api/v1/${chain}/status`]?.tip ?? null,
          reorg: null,
          completeness: 'complete',
          data: {},
        }));
      }
    });
  });
}

/**
 * A projected block's contents, in the compressed tuple form the socket uses:
 * [txid, fee, vsize, value, rate, flags, time, acc].
 *
 * Sized and spread so the Lens has something honest to draw: a long tail of
 * small transactions, a few large ones, and a spread of fee rates.
 */
function projectedBlockTransactions() {
  const txs = [];
  for (let i = 0; i < 1400; i++) {
    const big = i % 97 === 0;
    const vsize = big ? 2200 + (i % 11) * 400 : 140 + (i % 17) * 24;
    const rate = 2 + ((i * 7) % 46) + (big ? 12 : 0);
    txs.push([
      (i.toString(16).padStart(8, '0')).repeat(8).slice(0, 64),
      Math.round(rate * vsize),
      vsize,
      50_000 + (i % 53) * 90_000,
      rate,
      i % 13 === 0 ? 2 : 0,
      1_772_100_000 - (i % 900),
      0,
    ]);
  }
  return txs;
}

/** One socket push carrying the initial live state, from the same fixtures. */
function socketState(state) {
  // A node that is still verifying the chain. The explorer qualifies every
  // number on the page against this, so it has to be exercised: without it the
  // synchronisation notice never renders and never gets reviewed.
  const chainSync =
    state === 'catching-up'
      ? { blocks: 819_435, headers: 887_412, initialBlockDownload: true, verificationProgress: 0.663316, checkedAt: '2026-08-27T00:00:00.000Z' }
      : { blocks: 887_412, headers: 887_412, initialBlockDownload: false, verificationProgress: 1, checkedAt: '2026-08-27T00:00:00.000Z' };
  return {
    mempoolInfo: { loaded: true, size: 31_204, bytes: 118_442_881, usage: 118_442_881, maxmempool: 300_000_000, mempoolminfee: 0.00001, minrelaytxfee: 0.00001, fullrbf: true },
    vBytesPerSecond: 1_884,
    fees: fixtures['/api/v1/fees/recommended'],
    da: fixtures['/api/v1/difficulty-adjustment'],
    blocks: fixtures['/api/v1/blocks'],
    'mempool-blocks': fixtures['/api/v1/fees/mempool-blocks'],
    transactions: fixtures['/api/mempool/recent'],
    rbfLatestSummary: fixtures['rbf-latest-summary'],
    conversions: { USD: 96_400, EUR: 89_100, time: 1_772_100_000 },
    loadingIndicators: {
      mempool: 100,
      blocks: 100,
      // How far along the address's transaction history is. The address page
      // only draws its progress bar when the socket reports progress for that
      // address, so without this the one state that reaches the
      // transaction-list wait would render its skeletons and no bar at all,
      // and the bar would go on being unreviewed for the same reason the
      // branch itself was.
      ...(state === 'address-txs-loading' ? { [`address-${sampleIds.ADDRESS}`]: 62 } : {}),
    },
    backendInfo: { hostname: 'universe-explorer', version: '3.3.1', gitCommit: 'fixture0', lightning: false, chainSync },
  };
}

/** The hashed bundle names an index.html points at, as one comparable string. */
function bundleIdentity(html) {
  return [...html.matchAll(/(?:runtime|main|polyfills)\.[a-f0-9]{8,}\.js/g)]
    .map((match) => match[0])
    .sort()
    .join(' ');
}

async function run() {
  let bundleAtStart = '';
  const routes = pick(ROUTES, 'routes');
  const viewports = pick(VIEWPORTS, 'viewports');
  const themes = pick(THEMES.map((id) => ({ id })), 'themes').map((t) => t.id);
  const states = pick(STATES.map((id) => ({ id })), 'states').map((s) => s.id);

  // Confirm the base URL is actually serving this application before measuring
  // anything. A run against a blank page, a stale build, or something else that
  // happens to be on the port reports zero failures everywhere, which is
  // indistinguishable from success and considerably more dangerous. This has
  // happened: a port collision put a different product on the address and the
  // matrix cheerfully passed 39 blank screenshots.
  {
    const probe = await fetch(BASE, { redirect: 'follow' }).catch((e) => {
      throw new Error(`cannot reach ${BASE}: ${e.message}`);
    });
    if (!probe.ok) throw new Error(`${BASE} answered ${probe.status}`);
    const html = await probe.text();
    if (!/<title>[^<]*Universe Explorer/i.test(html)) {
      const title = (html.match(/<title>([^<]*)/i) || [, '(none)'])[1].trim();
      throw new Error(
        `${BASE} is not serving Universe Explorer (title: "${title}").` +
          ' Check the port, and that the build under test is the one being served.',
      );
    }
    if (!/(runtime|main)\.[a-f0-9]{8,}\.js/.test(html)) {
      throw new Error(`${BASE} served no hashed application bundle; the build output looks incomplete.`);
    }
    bundleAtStart = bundleIdentity(html);
  }

  mkdirSync(OUT, { recursive: true });

  // The Lens is drawn with WebGL. Headless Chromium has no GPU, so without a
  // software rasteriser the product's signature view is a grey rectangle in
  // every screenshot and the one thing worth reviewing goes unreviewed.
  const browser = await playwright[BROWSER].launch({
    args: BROWSER === 'chromium'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : [],
  });
  const findings = [];
  let shots = 0;

  for (const state of states) {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          reducedMotion: args.reducedMotion ? 'reduce' : 'no-preference',
        });
        await installFixtures(context, state);
        await context.addInitScript(([t, saved]) => {
          try {
            localStorage.setItem('theme-preference', t);
            // The saved page has an empty face and a populated one, and only
            // the empty one appears without this. Its state lives in the
            // browser, so the fixture goes in the browser.
            for (const [key, value] of Object.entries(saved)) {
              localStorage.setItem(key, JSON.stringify(value));
            }
          } catch { /* private mode: the default theme is fine */ }

          // A WebGL drawing buffer is cleared once the frame is presented, so
          // reading the Lens back afterwards returns nothing at all. Asking for
          // it to be preserved is what makes the product's signature view
          // measurable rather than a rectangle nobody checks. This only ever
          // runs in the harness; the application asks for the default.
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, attributes) {
            if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
              return getContext.call(this, type, { ...(attributes || {}), preserveDrawingBuffer: true });
            }
            return getContext.call(this, type, attributes);
          };
        }, [theme, savedStorageSeed]);

        for (const route of routes) {
          if (!stateApplies(state, route.id)) continue;
          if (context._fixtureRouter) {
            context._fixtureRouter.currentRouteId = route.id;
          }
          context._unmatchedFixtureErrors = [];
          const page = await context.newPage();
          const consoleErrors = [];
          const expectedFetchErrors = [];
          // A state that tells a request to fail gets exactly that, and the
          // browser writes its own line about it. That line is the fixture
          // speaking, not the application: the point of `chain-authority-down`
          // is a 503, and the page handling it correctly still produces one
          // console entry per refused request. Counted as a failure, the five
          // states the status vocabulary exists for could never run here at
          // all, which is why they never have.
          //
          // Narrow on purpose. Only on a state that declares a `status`
          // override, only for the browser's own resource line, and every one
          // is printed. Anything the application throws still counts, and so
          // does a resource failure on a state that asked for none.
          const stateFailsRequests = Object.values(ALL_OVERRIDES[state] ?? {})
            .some((override) => override && override.status);
          const isRefusedFetch = (textLine) =>
            stateFailsRequests
            && /Failed to load resource: the server responded with a status of \d+/.test(textLine);
          page.on('console', (m) => {
            if (m.type() !== 'error') return;
            (isRefusedFetch(m.text()) ? expectedFetchErrors : consoleErrors).push(m.text());
          });
          page.on('pageerror', (e) => consoleErrors.push(String(e)));

          const label = `${route.id}__${state}__${theme}__${viewport.id}`;
          try {
            await page.goto(BASE + route.path, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await page.waitForTimeout(state === 'loading' ? 1_200 : 2_600);

            // A route may name a control to open before anything is measured.
            // A menu that never opens is a menu nothing checks. When the
            // control is genuinely absent in this state, that is recorded as a
            // navigation failure rather than passed over, because a route that
            // measured the closed page instead is not the route that was asked
            // for.
            if (route.open) {
              const control = page.locator(route.open).first();
              if (await control.count()) {
                await control.click();
                await page.waitForTimeout(400);
              } else if (state === 'populated') {
                throw new Error(`${route.open} is not on the page, so this route measured the closed page instead of the open one`);
              }
            }

            const overflow = await page.evaluate(() => {
              const d = document.documentElement;
              return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
            });
            const overflowBy = overflow.scrollWidth - overflow.clientWidth;

            const brokenImages = await page.evaluate(() =>
              Array.from(document.images)
                .filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc)
                .map((i) => i.currentSrc),
            );

            let violations = [];
            const obscured = [];
            if (!args.skipAxe) {
              try {
                const axe = await new AxeBuilder({ page })
                  .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                  .analyze();
                violations = axe.violations.map((v) => ({
                  id: v.id,
                  impact: v.impact,
                  count: v.nodes.length,
                  help: v.help,
                  sample: v.nodes[0]?.target?.join(' ') ?? '',
                  // Every failing node, not just the first. A rule that reports
                  // "25 places" cannot be acted on without knowing which 25.
                  nodes: v.nodes.slice(0, 40).map((n) => ({
                    target: (n.target ?? []).join(' '),
                    detail: (n.any?.[0]?.message ?? n.failureSummary ?? '').slice(0, 200),
                  })),
                }));

                // Split off what an open overlay is expected to obscure. Only
                // on a route that declares it opens one, and only for nodes
                // axe itself says are obscured; a target that is simply too
                // small still fails here as it does everywhere else.
                if (route.overlayObscures) {
                  for (const violation of violations) {
                    if (violation.id !== 'target-size') continue;
                    const covered = violation.nodes.filter((n) => /obscured/i.test(n.detail));
                    if (!covered.length) continue;
                    obscured.push({ id: violation.id, nodes: covered });
                    violation.nodes = violation.nodes.filter((n) => !/obscured/i.test(n.detail));
                    violation.count -= covered.length;
                  }
                  violations = violations.filter((violation) => violation.nodes.length > 0);
                }
              } catch (e) {
                violations = [{ id: 'axe-failed', impact: 'unknown', count: 0, help: String(e).slice(0, 200), sample: '' }];
              }
            }

            // Measured contrast against whatever is actually painted. This is
            // the check an accessibility engine cannot make: text on a fee
            // gradient, on a block face, or over the Lens canvas.
            let contrast;
            try {
              contrast = await page.evaluate(contrastProbe);
            } catch (e) {
              contrast = { text: [], painted: [], canvas: [], sampled: 0, error: String(e).slice(0, 200) };
            }

            // Trigger anything the page defers until it is scrolled to.
            //
            // Angular's `@defer (on viewport)` loads a section when it
            // intersects the viewport, and the block page defers its
            // transaction list that way. A harness that never scrolls sees the
            // placeholder forever and reports a page that never finished, which
            // is the opposite of the truth: the page is deferring correctly.
            // The probe's own viewport margin is more generous than the zero
            // margin an IntersectionObserver uses, so at some widths it counted
            // a placeholder Angular had rightly not replaced yet.
            //
            // Scrolling to the bottom and back resolves both. Deferred content
            // loads, the view returns to the top so the screenshot is unchanged,
            // and a skeleton still showing afterwards is genuinely stuck.
            try {
              await page.evaluate(async () => {
                // Bounded twice over, and both bounds are load-bearing.
                //
                // The end of the loop cannot be `document.body.scrollHeight`
                // read fresh each time: a page whose list grows as it is
                // scrolled moves the end away faster than the loop reaches it,
                // and the harness scrolls until the process is killed. The
                // address page does exactly that, and it hung a matrix run for
                // twenty minutes on one route with nothing written out to say
                // where it had stopped.
                //
                // So the height is read once, and a step count caps it as well,
                // because a page that is already very long does not need to be
                // walked end to end to trigger the deferred blocks near the top
                // of it. Anything past thirty screens is below every
                // `@defer (on viewport)` boundary in the product.
                const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
                const end = Math.min(document.body.scrollHeight, step * 30);
                for (let y = 0; y < end; y += step) {
                  window.scrollTo(0, y);
                  await new Promise((done) => setTimeout(done, 90));
                }
                window.scrollTo(0, 0);
                await new Promise((done) => setTimeout(done, 250));
              });
            } catch { /* a page that navigated mid-scroll is judged as it lands */ }

            // A fixed pause is a race, not a deadline: on a loaded machine a
            // page that finishes perfectly well can still be mid-render when
            // the probe fires. Wait for it to settle, up to a real deadline,
            // and record how long it took. What fails the run is a page that
            // never settles, which is the actual requirement.
            let progress;
            let settledAfterMs = null;
            try {
              const budget = state === 'populated' ? SETTLE_DEADLINE_MS : FAILURE_SETTLE_DEADLINE_MS;
              const deadline = Date.now() + budget;
              for (;;) {
                progress = await page.evaluate(progressProbe);
                const busy = (progress.spinners?.length ?? 0) > 0 || (progress.skeletons ?? 0) > 0;
                if (!busy || Date.now() >= deadline) {
                  settledAfterMs = busy ? null : Date.now() - (deadline - budget);
                  break;
                }
                await page.waitForTimeout(250);
              }
            } catch (e) {
              progress = { spinners: [], skeletons: 0, charts: [], statusPanels: [], loadingAnnouncements: [], textLength: 0, error: String(e).slice(0, 200) };
            }

            await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: Boolean(args.fullPage) });
            shots++;

            const unmatchedFixtures = [...(context._unmatchedFixtureErrors || [])];
            findings.push({
              route: route.id, routeName: route.name, state, theme, viewport: viewport.id,
              overflowBy, consoleErrors, expectedFetchErrors, brokenImages, violations, obscured, contrast, progress, settledAfterMs,
              unmatchedFixtures,
            });
          } catch (error) {
            // A server that has gone away is not a page that failed. Reporting
            // it as one buries the actual event under a hundred identical
            // lines and sends the reader looking at the application.
            if (/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(String(error))) {
              await page.close().catch(() => undefined);
              await context.close().catch(() => undefined);
              await browser.close().catch(() => undefined);
              console.error(
                `\nThe server at ${BASE} stopped answering partway through the run ` +
                  `(at ${route.id}/${state}/${theme}@${viewport.id}). ` +
                  `Nothing was measured after that point, so this run proves nothing.`,
              );
              process.exit(2);
            }
            const unmatchedFixtures = [...(context._unmatchedFixtureErrors || [])];
            findings.push({
              route: route.id, routeName: route.name, state, theme, viewport: viewport.id,
              error: String(error).slice(0, 400),
              unmatchedFixtures,
            });
          } finally {
            await page.close();
          }
        }
        await context.close();
      }
    }
  }

  await browser.close();

  // The build must not have been rewritten underneath the run.
  //
  // A server that goes away entirely is already caught mid-run, above, where
  // a refused connection ends the run rather than logging a hundred identical
  // page failures. This is the case that guard cannot see: a server that keeps
  // answering while the files under it are replaced.
  //
  // An Angular production build empties its output directory before writing
  // it, so a rebuild during a matrix leaves a window where index.html and the
  // lazy chunks are simply absent. The pages served in that window have no
  // title and no lang attribute, which axe reports as two serious violations,
  // and their chunks 404. Every one of those findings is about the build being
  // replaced rather than about the interface, and nothing in the output said
  // so: eleven of them were indistinguishable from real ones until the cause
  // was found by hand.
  //
  // This is the same reasoning as the server-identity check at the start. That
  // one proves the right thing was being measured; this one proves it stayed
  // the right thing for the whole run.
  {
    const after = await fetch(BASE, { redirect: 'follow' })
      .then((response) => (response.ok ? response.text() : ''))
      .catch(() => '');
    const bundleAtEnd = bundleIdentity(after);
    if (bundleAtStart && bundleAtEnd && bundleAtEnd !== bundleAtStart) {
      throw new Error(
        [
          'the build changed while the matrix was running, so these results',
          'measure two different builds and some of them measure neither.',
          `  at the start: ${bundleAtStart}`,
          `  at the end:   ${bundleAtEnd}`,
          'Rebuild, then run the matrix with nothing else writing to the output.',
        ].join('\n'),
      );
    }
  }

  const report = { browser: BROWSER, base: BASE, screenshots: shots, findings };
  writeFileSync(join(OUT, `report-${BROWSER}.json`), JSON.stringify(report, null, 2));
  const { blocking: stuck, contrastNotMeasured, unmatched } = summarise(report);
  if (stuck.length > 0) {
    console.error(`${stuck.length} page(s) never finished loading. This is the failure that shipped last time, so it fails the run.`);
    process.exitCode = 1;
  }
  if (contrastNotMeasured.length > 0) {
    console.error(
      `${contrastNotMeasured.length} page(s) had no contrast measurement taken, so this run cannot claim their contrast is correct.`,
    );
    process.exitCode = 1;
  }
  if (unmatched && unmatched.length > 0) {
    console.error(
      `${unmatched.length} page(s) had unmatched fixture requests that failed closed.`,
    );
    process.exitCode = 1;
  }
}

/**
 * Turns the progress probe into failures.
 *
 * A populated fixture leaves no excuse: the data is there, so a loader still
 * on screen or a chart that drew nothing is the interface failing to finish.
 * A failure fixture has the opposite obligation: the page must say what
 * happened rather than wait.
 */

/**
 * Routes whose request lifecycle has been reviewed and is expected to reach a
 * terminal state. A finding on one of these fails the run.
 *
 * The gate reports findings on every route, but only blocks on these. Adding a
 * route here is how a finding on an uncovered route gets finished: fix the
 * page, add the route, and the gate holds it forever after. Home, blocks,
 * transaction and address joined once their waiting and failure states said
 * something instead of holding a bare placeholder.
 */
export const GATED_ROUTES = new Set([
  'graphs', 'mining', 'protocols', 'home', 'blocks', 'tx', 'address',
  // The chain routes join once their status rail, their failure copy and their
  // empty state all say something. Every one of them reaches a terminal state:
  // the rail renders all five readings even with no status at all, and a
  // failed lookup prints why rather than waiting.
  'dogecoin', 'dogecoin-mempool', 'dogecoin-tx', 'dogecoin-block',
  'dogecoin-address', 'dogecoin-protocols', 'dogecoin-drc20',
  'dogecoin-dunes', 'dogecoin-dune',
  'zcash', 'zcash-mempool', 'zcash-tx', 'zcash-protocols',
  'zcash-zrc20', 'zcash-zrc20-token',
  // The parity surfaces: dashboard timelines, mining, charts, and docs. The
  // whole point of this release is that these exist and hold the same bar.
  'dogecoin-mining', 'dogecoin-graphs', 'dogecoin-graphs-pools', 'dogecoin-docs',
  'zcash-mining', 'zcash-graphs', 'zcash-graphs-hashrate', 'zcash-docs',
  // The single-asset pages and the local-state page, for the same reason.
  'outpoint', 'inscription', 'rune', 'sat', 'saved',
  // Intelligence Platform routes
  'intelligence-policy-lab', 'intelligence-workbench', 'intelligence-verify-proof',
  'intelligence-relay', 'intelligence-time-machine', 'intelligence-mining-templates',
  'intelligence-utxo-set', 'intelligence-transaction-graph', 'intelligence-incidents',
  'intelligence-knowledge', 'intelligence-developers', 'intelligence-query-studio',
  'intelligence-watchlists', 'intelligence-protocols',
]);

/**
 * Fixtures that hold a request open on purpose, to photograph a wait.
 *
 * These are judged on whether the wait is announced, not on having finished,
 * and they are not failure states: nothing has gone wrong, so demanding a
 * status panel would be demanding the page report a fault it does not have.
 * `loading` holds every request; `address-txs-loading` holds only the address
 * transaction list, which is the wait pagination leaves behind and the one the
 * blanket fixture can never reach.
 */
const WAITING_STATES = new Set(['loading', 'address-txs-loading']);

export function progressFailures(report) {
  const failures = [];
  for (const f of report.findings) {
    const progress = f.progress;
    if (!progress) continue;
    const where = `${f.route}/${f.state}/${f.theme}@${f.viewport}`;

    if (f.state === 'populated') {
      if (progress.spinners?.length) {
        failures.push(`${where}: never stopped loading (${progress.spinners.join(', ')})`);
      }
      if (progress.skeletons > 0) {
        failures.push(`${where}: ${progress.skeletons} skeleton(s) never resolved`);
      }
      if (progress.skeletonOnly) {
        failures.push(`${where}: the page is placeholders and almost no text`);
      }
      for (const chart of progress.charts ?? []) {
        if (chart.drewNothing) {
          failures.push(`${where}: chart ${chart.selector} (${chart.width}x${chart.height}) drew nothing`);
        }
      }
    } else if (WAITING_STATES.has(f.state)) {
      // These fixtures hold requests open on purpose, to photograph the
      // waiting state. Asking them to have finished would be asking the wrong
      // question; what matters is that the wait is announced rather than being
      // a blank rectangle. The deadline itself is covered by the unit tests
      // around the request lifecycle, which run far longer than this harness
      // waits.
      // Only a page that is actually holding placeholders is waiting. A page
      // with nothing to fetch renders normally under this fixture and owes the
      // reader no loader at all.
      const waiting = (progress.skeletons ?? 0) > 0;
      const announced = progress.spinners?.length
        || progress.statusPanels?.length
        || progress.loadingAnnouncements?.length;
      if (waiting && !announced) {
        failures.push(`${where}: waiting with nothing on screen that says so`);
      }
    } else {
      // Every failure fixture must reach a state that says something. A page
      // that is still spinning has not answered the user at all.
      if (progress.spinners?.length || progress.skeletons > 0) {
        if (!progress.statusPanels?.length) {
          failures.push(`${where}: still waiting with nothing said about why`);
        }
      }
    }
  }
  return failures;
}

function summarise(report) {
  const overflow = report.findings.filter((f) => f.overflowBy > 0);
  const errors = report.findings.filter((f) => f.consoleErrors?.length);
  const images = report.findings.filter((f) => f.brokenImages?.length);
  const failed = report.findings.filter((f) => f.error);
  const a11y = report.findings.filter((f) => f.violations?.length);
  const unmatched = report.findings.filter((f) => f.unmatchedFixtures?.length);

  const contrastFailures = [];
  const blankCanvases = [];
  // Pages where the contrast probe did not run at all.
  //
  // Its failure path records an error and an empty result, and an empty result
  // is what a clean page produces too, so both printed "contrast failures: 0".
  // A gate that measures nothing and a gate that measures everything and finds
  // nothing wrong are not the same statement, and this is the one check here
  // that an accessibility engine cannot make, so its silence is expensive.
  const contrastNotMeasured = [];
  // Pages where it ran and found nothing to measure. Legitimate on a page that
  // is genuinely empty, so this is reported rather than failed, but it is not
  // evidence of contrast being correct either.
  const contrastNoSamples = [];
  for (const f of report.findings) {
    const where = { route: f.route, state: f.state, theme: f.theme, viewport: f.viewport };
    if (f.contrast?.error) {
      contrastNotMeasured.push({ ...where, error: f.contrast.error });
    } else if (f.contrast && (f.contrast.sampled ?? 0) === 0 && !f.error) {
      contrastNoSamples.push(where);
    }
    for (const row of f.contrast?.text ?? []) {
      contrastFailures.push({ ...row, ...where });
    }
    for (const c of f.contrast?.canvas ?? []) {
      if (c.blank) blankCanvases.push({ ...c, ...where });
    }
  }
  contrastFailures.sort((a, b) => a.ratio - b.ratio);

  const byRule = new Map();
  for (const f of a11y) {
    for (const v of f.violations) {
      const e = byRule.get(v.id) || { id: v.id, impact: v.impact, help: v.help, places: 0, routes: new Set() };
      e.places += v.count;
      e.routes.add(f.route);
      byRule.set(v.id, e);
    }
  }

  console.log(`\n=== ${report.browser} : ${report.screenshots} screenshots -> ${OUT}\n`);
  console.log(`horizontal overflow : ${overflow.length}`);
  console.log(`console errors      : ${errors.length}`);

  // Printed, never counted. A state that asked a request to fail got one line
  // per refusal, and a rule that is quietly not counted is a rule nobody sees.
  const refused = report.findings.flatMap((f) =>
    (f.expectedFetchErrors ?? []).map((line) => `${f.route}/${f.state} ${line}`),
  );
  if (refused.length) {
    console.log(`refused by a failure fixture : ${refused.length}  (asked for, not counted)`);
    for (const line of refused.slice(0, 8)) console.log(`    ${line}`);
    if (refused.length > 8) console.log(`    ... and ${refused.length - 8} more`);
  }
  console.log(`broken images       : ${images.length}`);
  console.log(`navigation failures : ${failed.length}`);
  console.log(`a11y rules violated : ${byRule.size}`);
  console.log(`unmatched fixtures  : ${unmatched.length}`);

  // Reported, never counted, and never silent. A route that opens a menu is
  // measured with the menu open, so the controls beneath it read as obscured.
  // Printing each one is what keeps this from becoming a rule nobody sees.
  const covered = report.findings.flatMap((f) =>
    (f.obscured ?? []).flatMap((v) =>
      v.nodes.map((n) => `${f.route}@${f.viewport}/${f.theme} ${n.target}`),
    ),
  );
  if (covered.length) {
    console.log(`obscured by an open overlay : ${covered.length}  (expected, not counted)`);
    for (const line of covered.slice(0, 12)) console.log(`    ${line}`);
    if (covered.length > 12) console.log(`    ... and ${covered.length - 12} more`);
  }
  console.log('');

  console.log(`contrast failures   : ${contrastFailures.length}`);
  if (contrastNotMeasured.length) {
    console.log(`contrast NOT MEASURED: ${contrastNotMeasured.length}  (the probe threw; the zero above is not a result)`);
  }
  if (contrastNoSamples.length) {
    console.log(`contrast no samples : ${contrastNoSamples.length}  (ran, found no text to measure)`);
  }
  console.log(`blank canvases      : ${blankCanvases.length}`);

  if (contrastFailures.length) {
    console.log();
    console.log('-- measured contrast failures, worst first --');
    for (const f of contrastFailures.slice(0, 40)) {
      console.log(
        `  ${String(f.ratio).padStart(6)}:1 (needs ${f.required}:1)  ` +
          `${f.route}/${f.state}/${f.theme}@${f.viewport}` +
          `${f.overPaintedSurface ? '  [over a painted surface]' : ''}`,
      );
      console.log(`         "${f.text}"`);
      console.log(`         ${f.foreground} on ${f.background}   ${f.selector}`);
    }
    if (contrastFailures.length > 40) {
      console.log(`  ... and ${contrastFailures.length - 40} more, see the report`);
    }
  }

  if (contrastNotMeasured.length) {
    console.log();
    console.log('-- pages where the contrast probe did not run --');
    for (const f of contrastNotMeasured.slice(0, 20)) {
      console.log(`  ${f.route}/${f.state}/${f.theme}@${f.viewport}: ${f.error}`);
    }
  }

  if (blankCanvases.length) {
    console.log();
    console.log('-- canvases that drew nothing --');
    for (const c of blankCanvases.slice(0, 10)) {
      console.log(`  ${c.route}/${c.state}/${c.theme}@${c.viewport}  ${c.selector}  ${c.w}x${c.h}`);
    }
  }
  if (overflow.length) {
    console.log('-- overflow --');
    for (const f of overflow.slice(0, 20)) {
      console.log(`  ${f.route} ${f.state} ${f.theme} @${f.viewport}px overflows by ${f.overflowBy}px`);
    }
  }
  if (byRule.size) {
    console.log('\n-- accessibility --');
    for (const r of [...byRule.values()].sort((a, b) => b.places - a.places)) {
      console.log(`  ${String(r.impact).padEnd(8)} ${r.id.padEnd(34)} ${String(r.places).padStart(4)} places  [${[...r.routes].join(', ')}]`);
      console.log(`           ${r.help}`);
    }
  }
  if (errors.length) {
    console.log('\n-- console --');
    const seen = new Set();
    for (const f of errors) {
      for (const e of f.consoleErrors) {
        const key = e.slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  [${f.route}] ${key}`);
      }
    }
  }
  if (failed.length) {
    console.log('\n-- navigation --');
    for (const f of failed.slice(0, 15)) console.log(`  ${f.route} ${f.state} ${f.theme} @${f.viewport}: ${f.error}`);
  }
  if (unmatched.length) {
    console.log('\n-- unmatched fixtures (failed closed) --');
    for (const f of unmatched.slice(0, 20)) {
      for (const err of f.unmatchedFixtures) {
        console.log(`  [${f.route}/${f.state}] ${err}`);
      }
    }
  }

  const stuck = progressFailures(report);
  const blocking = stuck.filter((line) => GATED_ROUTES.has(line.split('/')[0]));
  const known = stuck.filter((line) => !GATED_ROUTES.has(line.split('/')[0]));

  console.log(`\nunfinished pages    : ${stuck.length}  (blocking ${blocking.length})`);
  if (blocking.length) {
    console.log('-- pages that never finished, on routes this gate holds --');
    for (const line of blocking.slice(0, 40)) console.log(`  ${line}`);
    if (blocking.length > 40) console.log(`  ... and ${blocking.length - 40} more, see the report`);
  }
  if (known.length) {
    // Printed every run, never suppressed. These are real, they were found by
    // this gate, and they are waiting for the same treatment the gated routes
    // have had.
    console.log('-- the same fault on routes not yet covered, known work --');
    for (const line of known.slice(0, 40)) console.log(`  ${line}`);
    if (known.length > 40) console.log(`  ... and ${known.length - 40} more, see the report`);
  }
  console.log('');
  return { blocking, contrastNotMeasured, unmatched };
}

// Only drive browsers when this file is the program. Importing it, as the
// gate's own test does, must not launch the matrix.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
