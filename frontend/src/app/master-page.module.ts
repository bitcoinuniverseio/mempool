import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Routes, RouterModule, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { MasterPageComponent } from '@components/master-page/master-page.component';
import { SharedModule } from '@app/shared/shared.module';

import { StartComponent } from '@components/start/start.component';
import { PushTransactionComponent } from '@components/push-transaction/push-transaction.component';
import { TestTransactionsComponent } from '@components/test-transactions/test-transactions.component';
import { CalculatorComponent } from '@components/calculator/calculator.component';
import { BlocksList } from '@components/blocks-list/blocks-list.component';
import { RbfList } from '@components/rbf-list/rbf-list.component';
import { StaleList } from '@components/stale-list/stale-list.component';
import { StratumList } from '@components/stratum/stratum-list/stratum-list.component';
import { ServerHealthComponent } from '@components/server-health/server-health.component';
import { ServerStatusComponent } from '@components/server-health/server-status.component';
import { FaucetComponent } from '@components/faucet/faucet.component';
import { SimpleProofWidgetComponent } from '@components/simpleproof-widget/simpleproof-widget.component';
import { SimpleProofCuboWidgetComponent } from '@components/simpleproof-widget/simpleproof-cubo-widget.component';
import { ChainSyncNoticeComponent } from '@app/universe/chain-sync-notice/chain-sync-notice.component';
import { ConnectivityBannerComponent } from '@app/universe/pwa/connectivity-banner.component';
import { CommandPaletteComponent } from '@app/universe/command-center/command-palette.component';

const browserWindow = window || {};
// @ts-ignore
const browserWindowEnv = browserWindow.__env || {};

const routes: Routes = [
  {
    path: '',
    component: MasterPageComponent,
    children: [
      {
        path: 'mining/blocks',
        redirectTo: 'blocks',
        pathMatch: 'full'
      },
      {
        path: 'tx/push',
        component: PushTransactionComponent,
      },
      {
        path: 'pushtx',
        component: PushTransactionComponent,
      },
      {
        path: 'tx/test',
        component: TestTransactionsComponent,
      },
      {
        path: 'blocks/stale',
        component: StaleList,
      },
      {
        path: 'blocks/:page',
        component: BlocksList,
      },
      {
        path: 'blocks',
        redirectTo: 'blocks/1',
      },
      {
        path: 'rbf',
        component: RbfList,
      },
      ...(browserWindowEnv.STRATUM_ENABLED ? [{
        path: 'stratum',
        component: StartComponent,
        children: [
          {
            path: '',
            component: StratumList,
          }
        ]
      }] : []),
      {
        path: 'terms-of-service',
        loadChildren: () => import('@components/terms-of-service/terms-of-service.module').then(m => m.TermsOfServiceModule),
      },
      {
        path: 'privacy-policy',
        loadChildren: () => import('@components/privacy-policy/privacy-policy.module').then(m => m.PrivacyPolicyModule),
      },
      {
        path: 'tx',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () => import('@components/transaction/transaction.module').then(m => m.TransactionModule),
      },
      {
        path: 'block',
        component: StartComponent,
        data: { preload: true, networkSpecific: true },
        loadChildren: () => import('@components/block/block.module').then(m => m.BlockModule),
      },
      {
        path: 'docs',
        loadChildren: () => import('@app/docs/docs.module').then(m => m.DocsModule),
        data: { preload: true },
      },
      {
        path: 'api',
        loadChildren: () => import('@app/docs/docs.module').then(m => m.DocsModule)
      },
      {
        path: 'lightning',
        loadChildren: () => import('@app/lightning/lightning.module').then(m => m.LightningModule),
        data: { preload: browserWindowEnv && browserWindowEnv.LIGHTNING === true, networks: ['bitcoin'] },
      },
      {
        path: 'protocols',
        loadChildren: () => import('@app/universe/universe.module').then(m => m.UniverseModule),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'dogecoin',
        loadChildren: () => import('@app/universe/multichain-explorer/multichain-explorer.module').then(m => m.MultichainExplorerModule),
        data: { networks: ['bitcoin'], chain: 'dogecoin' },
      },
      {
        path: 'zcash',
        loadChildren: () => import('@app/universe/multichain-explorer/multichain-explorer.module').then(m => m.MultichainExplorerModule),
        data: { networks: ['bitcoin'], chain: 'zcash' },
      },
      {
        path: 'anima',
        loadChildren: () => import('@app/universe/anima/anima.routes').then(m => m.ANIMA_ROUTES),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'wildkin',
        loadComponent: () => import('@app/universe/wildkin/wildkin.component').then(m => m.WildkinComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'wildkin/creatures',
        loadComponent: () => import('@app/universe/wildkin/wildkin-creatures.component').then(m => m.WildkinCreaturesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'wildkin/creature/:id',
        loadComponent: () => import('@app/universe/wildkin/wildkin-creatures.component').then(m => m.WildkinCreaturesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'wildkin/bloodlines',
        loadComponent: () => import('@app/universe/wildkin/wildkin-bloodlines.component').then(m => m.WildkinBloodlinesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'fractal',
        loadComponent: () => import('@app/universe/fractal/fractal-dashboard.component').then(m => m.FractalDashboardComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'fractal/cat20',
        loadComponent: () => import('@app/universe/fractal/cat20-center.component').then(m => m.Cat20CenterComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'fractal/cat20/token/:tokenId',
        loadComponent: () => import('@app/universe/fractal/cat20-center.component').then(m => m.Cat20CenterComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'zcash/privacy',
        loadComponent: () => import('@app/universe/zcash-privacy/zcash-privacy.component').then(m => m.ZcashPrivacyComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'zcash/privacy/workspace',
        loadComponent: () => import('@app/universe/zcash-privacy/zcash-viewing-key-workspace.component').then(m => m.ZcashViewingKeyWorkspaceComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'liquid/observatory',
        loadComponent: () => import('@app/universe/liquid-observatory/liquid-observatory.component').then(m => m.LiquidObservatoryComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'liquid/unblind',
        loadComponent: () => import('@app/universe/liquid-observatory/liquid-unblind-workspace.component').then(m => m.LiquidUnblindWorkspaceComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'data',
        loadComponent: () => import('@app/universe/data-studio/data-studio.component').then(m => m.DataStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'data/live',
        loadComponent: () => import('@app/universe/data-studio/data-live-stream.component').then(m => m.DataLiveStreamComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/propagation',
        loadComponent: () => import('@app/universe/network-observatory/network-observatory.component').then(m => m.NetworkObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/policy',
        loadComponent: () => import('@app/universe/network-observatory/network-observatory.component').then(m => m.NetworkObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/nodes',
        loadComponent: () => import('@app/universe/network-observatory/network-observatory.component').then(m => m.NetworkObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/templates',
        loadComponent: () => import('@app/universe/network-observatory/network-observatory.component').then(m => m.NetworkObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'taproot-assets',
        loadComponent: () => import('@app/universe/taproot-assets/taproot-assets.component').then(m => m.TaprootAssetsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'taproot-assets/asset/:assetId',
        loadComponent: () => import('@app/universe/taproot-assets/taproot-assets.component').then(m => m.TaprootAssetsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/offers',
        loadComponent: () => import('@app/universe/taproot-assets/lightning-standards.component').then(m => m.LightningStandardsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/rfq',
        loadComponent: () => import('@app/universe/taproot-assets/lightning-standards.component').then(m => m.LightningStandardsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark',
        loadComponent: () => import('@app/universe/ark/ark-dashboard.component').then(m => m.ArkDashboardComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'rgb',
        loadComponent: () => import('@app/universe/rgb/rgb-studio.component').then(m => m.RgbStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'rgb/validate',
        loadComponent: () => import('@app/universe/rgb/rgb-studio.component').then(m => m.RgbStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mining/stratum-v2',
        loadComponent: () => import('@app/universe/stratum-v2/stratum-v2.component').then(m => m.StratumV2Component),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/script',
        loadComponent: () => import('@app/universe/script-studio/script-studio.component').then(m => m.ScriptStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/miniscript',
        loadComponent: () => import('@app/universe/script-studio/script-studio.component').then(m => m.ScriptStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/descriptor',
        loadComponent: () => import('@app/universe/script-studio/script-studio.component').then(m => m.ScriptStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/taproot',
        loadComponent: () => import('@app/universe/script-studio/script-studio.component').then(m => m.ScriptStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'l2',
        loadComponent: () => import('@app/universe/l2-observatory/l2-observatory.component').then(m => m.L2ObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'l2/:systemId',
        loadComponent: () => import('@app/universe/l2-observatory/l2-observatory.component').then(m => m.L2ObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/payment',
        loadComponent: () => import('@app/universe/payment-studio/payment-studio.component').then(m => m.PaymentStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/payment/bip21',
        loadComponent: () => import('@app/universe/payment-studio/payment-studio.component').then(m => m.PaymentStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/payment/bip353',
        loadComponent: () => import('@app/universe/payment-studio/payment-studio.component').then(m => m.PaymentStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      // Intelligence Platform: Tools
      {
        path: 'tools/policy-lab',
        loadComponent: () => import('@app/universe/intelligence-platform/policy-lab.component').then(m => m.PolicyLabComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/workbench',
        loadComponent: () => import('@app/universe/intelligence-platform/script-workbench.component').then(m => m.ScriptWorkbenchComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/verify-proof',
        loadComponent: () => import('@app/universe/intelligence-platform/verify-proof.component').then(m => m.VerifyProofComponent),
        data: { networks: ['bitcoin'] },
      },
      // Intelligence Platform: Intelligence
      {
        path: 'intelligence/relay',
        loadComponent: () => import('@app/universe/intelligence-platform/relay-observatory.component').then(m => m.RelayObservatoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/time-machine',
        loadComponent: () => import('@app/universe/intelligence-platform/time-machine.component').then(m => m.TimeMachineComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/mining-templates',
        loadComponent: () => import('@app/universe/intelligence-platform/mining-templates.component').then(m => m.MiningTemplatesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/utxo-set',
        loadComponent: () => import('@app/universe/intelligence-platform/utxo-intelligence.component').then(m => m.UtxoIntelligenceComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/transaction-graph',
        loadComponent: () => import('@app/universe/intelligence-platform/transaction-graph.component').then(m => m.TransactionGraphComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/incidents',
        loadComponent: () => import('@app/universe/intelligence-platform/incident-center.component').then(m => m.IncidentCenterComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/knowledge',
        loadComponent: () => import('@app/universe/intelligence-platform/knowledge-registry.component').then(m => m.KnowledgeRegistryComponent),
        data: { networks: ['bitcoin'] },
      },
      // Intelligence Platform: Developers
      {
        path: 'developers',
        loadComponent: () => import('@app/universe/intelligence-platform/developer-platform.component').then(m => m.DeveloperPlatformComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'developers/query-studio',
        loadComponent: () => import('@app/universe/intelligence-platform/query-studio.component').then(m => m.QueryStudioComponent),
        data: { networks: ['bitcoin'] },
      },
      // Intelligence Platform: User
      {
        path: 'user/watchlists',
        loadComponent: () => import('@app/universe/intelligence-platform/watchlists.component').then(m => m.WatchlistsComponent),
        data: { networks: ['bitcoin'] },
      },
      // Intelligence Platform: Explore
      {
        path: 'explore/protocols',
        loadComponent: () => import('@app/universe/intelligence-platform/protocol-explorer.component').then(m => m.ProtocolExplorerComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 1: Global Bitcoin Network Observatory
      {
        path: 'network/global',
        loadComponent: () => import('@app/universe/global-network/global-network-overview.component').then(m => m.GlobalNetworkOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/global/nodes',
        loadComponent: () => import('@app/universe/global-network/global-network-nodes.component').then(m => m.GlobalNetworkNodesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/global/node/:endpointId',
        loadComponent: () => import('@app/universe/global-network/global-network-node-detail.component').then(m => m.GlobalNetworkNodeDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/global/snapshots',
        loadComponent: () => import('@app/universe/global-network/global-network-snapshots.component').then(m => m.GlobalNetworkSnapshotsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/global/seeds',
        loadComponent: () => import('@app/universe/global-network/global-network-seeds.component').then(m => m.GlobalNetworkSeedsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/global/self-check',
        loadComponent: () => import('@app/universe/global-network/global-network-self-check.component').then(m => m.GlobalNetworkSelfCheckComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 2: Lightning Reliability, Liquidity, and Channel Lifecycle Center
      {
        path: 'lightning/reliability',
        loadComponent: () => import('@app/universe/lightning-reliability/lightning-reliability-overview.component').then(m => m.LightningReliabilityOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/liquidity',
        loadComponent: () => import('@app/universe/lightning-reliability/lightning-liquidity.component').then(m => m.LightningLiquidityComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/lsp',
        loadComponent: () => import('@app/universe/lightning-reliability/lightning-lsp.component').then(m => m.LightningLspComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/node/:publicKey/reliability',
        loadComponent: () => import('@app/universe/lightning-reliability/lightning-node-reliability.component').then(m => m.LightningNodeReliabilityComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/channel/:shortId/lifecycle',
        loadComponent: () => import('@app/universe/lightning-reliability/lightning-channel-lifecycle.component').then(m => m.LightningChannelLifecycleComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/closure/:txid',
        loadComponent: () => import('@app/universe/lightning-reliability/lightning-closure-forensics.component').then(m => m.LightningClosureForensicsComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 3: Silent Payments Center
      {
        path: 'payments/silent',
        loadComponent: () => import('@app/universe/silent-payments/silent-payments-overview.component').then(m => m.SilentPaymentsOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/silent/scan',
        loadComponent: () => import('@app/universe/silent-payments/silent-payments-scan.component').then(m => m.SilentPaymentsScanComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/silent/address',
        loadComponent: () => import('@app/universe/silent-payments/silent-payments-address.component').then(m => m.SilentPaymentsAddressComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/silent/psbt',
        loadComponent: () => import('@app/universe/silent-payments/silent-payments-psbt.component').then(m => m.SilentPaymentsPsbtComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/silent/coverage',
        loadComponent: () => import('@app/universe/silent-payments/silent-payments-coverage.component').then(m => m.SilentPaymentsCoverageComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 4: Collaborative Payments and Payjoin Center
      {
        path: 'payments/payjoin',
        loadComponent: () => import('@app/universe/payjoin/payjoin-overview.component').then(m => m.PayjoinOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/payjoin/analyze',
        loadComponent: () => import('@app/universe/payjoin/payjoin-analyze.component').then(m => m.PayjoinAnalyzeComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/payjoin/directory',
        loadComponent: () => import('@app/universe/payjoin/payjoin-directory.component').then(m => m.PayjoinDirectoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/payjoin/compatibility',
        loadComponent: () => import('@app/universe/payjoin/payjoin-compatibility.component').then(m => m.PayjoinCompatibilityComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/payjoin/playground',
        loadComponent: () => import('@app/universe/payjoin/payjoin-playground.component').then(m => m.PayjoinPlaygroundComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 5: Ecash and Federation Observatory
      {
        path: 'ecash',
        loadComponent: () => import('@app/universe/ecash/ecash-overview.component').then(m => m.EcashOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ecash/cashu',
        loadComponent: () => import('@app/universe/ecash/ecash-cashu.component').then(m => m.EcashCashuComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ecash/cashu/:mintId',
        loadComponent: () => import('@app/universe/ecash/ecash-cashu-detail.component').then(m => m.EcashCashuDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ecash/fedimint',
        loadComponent: () => import('@app/universe/ecash/ecash-fedimint.component').then(m => m.EcashFedimintComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ecash/fedimint/:federationId',
        loadComponent: () => import('@app/universe/ecash/ecash-fedimint-detail.component').then(m => m.EcashFedimintDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ecash/inspect',
        loadComponent: () => import('@app/universe/ecash/ecash-inspect.component').then(m => m.EcashInspectComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 6: Consensus Upgrade, Covenant, and Vault Lab
      {
        path: 'labs/consensus',
        loadComponent: () => import('@app/universe/consensus/consensus-proposals.component').then(m => m.ConsensusProposalsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/:proposalId',
        loadComponent: () => import('@app/universe/consensus/consensus-proposal-detail.component').then(m => m.ConsensusProposalDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/compare',
        loadComponent: () => import('@app/universe/consensus/consensus-compare.component').then(m => m.ConsensusCompareComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/vaults',
        loadComponent: () => import('@app/universe/consensus/vaults-overview.component').then(m => m.VaultsOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/vaults/designer',
        loadComponent: () => import('@app/universe/consensus/vaults-designer.component').then(m => m.VaultsDesignerComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/vaults/simulate',
        loadComponent: () => import('@app/universe/consensus/vaults-simulate.component').then(m => m.VaultsSimulateComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 7: Quantum Exposure and Migration Readiness Center
      {
        path: 'intelligence/quantum',
        loadComponent: () => import('@app/universe/quantum/quantum-overview.component').then(m => m.QuantumOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/quantum/exposure',
        loadComponent: () => import('@app/universe/quantum/quantum-exposure.component').then(m => m.QuantumExposureComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/quantum/history',
        loadComponent: () => import('@app/universe/quantum/quantum-history.component').then(m => m.QuantumHistoryComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/quantum/audit',
        loadComponent: () => import('@app/universe/quantum/quantum-audit.component').then(m => m.QuantumAuditComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/quantum/migration',
        loadComponent: () => import('@app/universe/quantum/quantum-migration.component').then(m => m.QuantumMigrationComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 8: Blockspace Demand and Transaction Semantics Terminal
      {
        path: 'intelligence/blockspace',
        loadComponent: () => import('@app/universe/blockspace/blockspace-overview.component').then(m => m.BlockspaceOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/blockspace/composition',
        loadComponent: () => import('@app/universe/blockspace/blockspace-composition.component').then(m => m.BlockspaceCompositionComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/blockspace/regimes',
        loadComponent: () => import('@app/universe/blockspace/blockspace-regimes.component').then(m => m.BlockspaceRegimesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/blockspace/compare',
        loadComponent: () => import('@app/universe/blockspace/blockspace-compare.component').then(m => m.BlockspaceCompareComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/blockspace/taxonomy',
        loadComponent: () => import('@app/universe/blockspace/blockspace-taxonomy.component').then(m => m.BlockspaceTaxonomyComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 9: Reserves and Solvency Verification Center
      {
        path: 'intelligence/reserves',
        loadComponent: () => import('@app/universe/reserves/reserves-overview.component').then(m => m.ReservesOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/reserves/providers',
        loadComponent: () => import('@app/universe/reserves/reserves-providers.component').then(m => m.ReservesProvidersComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/reserves/provider/:providerId',
        loadComponent: () => import('@app/universe/reserves/reserves-provider-detail.component').then(m => m.ReservesProviderDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/reserves/snapshot/:snapshotId',
        loadComponent: () => import('@app/universe/reserves/reserves-snapshot-detail.component').then(m => m.ReservesSnapshotDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/reserves/verify',
        loadComponent: () => import('@app/universe/reserves/reserves-verify.component').then(m => m.ReservesVerifyComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 1: Discreet Log Contract and Oracle Verification Center
      {
        path: 'contracts/dlc',
        loadComponent: () => import('@app/universe/dlc/dlc-overview.component').then(m => m.DlcOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'contracts/dlc/oracles',
        loadComponent: () => import('@app/universe/dlc/dlc-oracles.component').then(m => m.DlcOraclesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'contracts/dlc/oracle/:oracleId',
        loadComponent: () => import('@app/universe/dlc/dlc-oracle-detail.component').then(m => m.DlcOracleDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'contracts/dlc/events',
        loadComponent: () => import('@app/universe/dlc/dlc-events.component').then(m => m.DlcEventsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'contracts/dlc/event/:eventId',
        loadComponent: () => import('@app/universe/dlc/dlc-event-detail.component').then(m => m.DlcEventDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'contracts/dlc/inspect',
        loadComponent: () => import('@app/universe/dlc/dlc-inspect.component').then(m => m.DlcInspectComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'contracts/dlc/simulate',
        loadComponent: () => import('@app/universe/dlc/dlc-simulate.component').then(m => m.DlcSimulateComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 2: Simplicity Contract Explorer and Formal Verification Workbench
      {
        path: 'liquid/simplicity',
        loadComponent: () => import('@app/universe/simplicity/simplicity-overview.component').then(m => m.SimplicityOverviewComponent),
        data: { networks: ['liquid'] },
      },
      {
        path: 'liquid/simplicity/contracts',
        loadComponent: () => import('@app/universe/simplicity/simplicity-contracts.component').then(m => m.SimplicityContractsComponent),
        data: { networks: ['liquid'] },
      },
      {
        path: 'liquid/simplicity/tx/:txid',
        loadComponent: () => import('@app/universe/simplicity/simplicity-tx.component').then(m => m.SimplicityTxComponent),
        data: { networks: ['liquid'] },
      },
      {
        path: 'liquid/simplicity/program/:programId',
        loadComponent: () => import('@app/universe/simplicity/simplicity-program-detail.component').then(m => m.SimplicityProgramDetailComponent),
        data: { networks: ['liquid'] },
      },
      {
        path: 'tools/simplicity',
        loadComponent: () => import('@app/universe/simplicity/simplicity-tools.component').then(m => m.SimplicityToolsComponent),
        data: { networks: ['liquid', 'bitcoin'] },
      },
      {
        path: 'tools/simplicity/verify',
        loadComponent: () => import('@app/universe/simplicity/simplicity-verify.component').then(m => m.SimplicityVerifyComponent),
        data: { networks: ['liquid', 'bitcoin'] },
      },
      // Product 3: Statechain, CoinSwap, and Off-Chain UTXO Recovery Center
      {
        path: 'offchain/utxo',
        loadComponent: () => import('@app/universe/offchain/offchain-utxo.component').then(m => m.OffchainUtxoComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/statechains',
        loadComponent: () => import('@app/universe/offchain/statechain-operators.component').then(m => m.StatechainOperatorsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/statechains/operators',
        loadComponent: () => import('@app/universe/offchain/statechain-operators.component').then(m => m.StatechainOperatorsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/statechains/operator/:operatorId',
        loadComponent: () => import('@app/universe/offchain/statechain-operator-detail.component').then(m => m.StatechainOperatorDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/statechains/verify',
        loadComponent: () => import('@app/universe/offchain/statechain-verify.component').then(m => m.StatechainVerifyComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/coinswap',
        loadComponent: () => import('@app/universe/offchain/coinswap-overview.component').then(m => m.CoinswapOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/coinswap/inspect',
        loadComponent: () => import('@app/universe/offchain/coinswap-inspect.component').then(m => m.CoinswapInspectComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'offchain/recovery',
        loadComponent: () => import('@app/universe/offchain/offchain-recovery.component').then(m => m.OffchainRecoveryComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 4: Compact Filter and Light-Client Verification Center
      {
        path: 'network/light-client',
        loadComponent: () => import('@app/universe/compact-filters/light-client-overview.component').then(m => m.LightClientOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/light-client/providers',
        loadComponent: () => import('@app/universe/compact-filters/light-client-providers.component').then(m => m.LightClientProvidersComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/light-client/provider/:providerId',
        loadComponent: () => import('@app/universe/compact-filters/light-client-provider-detail.component').then(m => m.LightClientProviderDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/light-client/filters',
        loadComponent: () => import('@app/universe/compact-filters/light-client-filters.component').then(m => m.LightClientFiltersComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/light-client/verify',
        loadComponent: () => import('@app/universe/compact-filters/light-client-verify.component').then(m => m.LightClientVerifyComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/light-client/scan',
        loadComponent: () => import('@app/universe/compact-filters/light-client-scan.component').then(m => m.LightClientScanComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/light-client/privacy',
        loadComponent: () => import('@app/universe/compact-filters/light-client-privacy.component').then(m => m.LightClientPrivacyComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 5: AssumeUTXO and Node Bootstrap Snapshot Center
      {
        path: 'node/bootstrap',
        loadComponent: () => import('@app/universe/bootstrap/bootstrap-overview.component').then(m => m.BootstrapOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/bootstrap/snapshots',
        loadComponent: () => import('@app/universe/bootstrap/bootstrap-snapshots.component').then(m => m.BootstrapSnapshotsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/bootstrap/snapshot/:heightOrHash',
        loadComponent: () => import('@app/universe/bootstrap/bootstrap-snapshot-detail.component').then(m => m.BootstrapSnapshotDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/bootstrap/verify',
        loadComponent: () => import('@app/universe/bootstrap/bootstrap-verify.component').then(m => m.BootstrapVerifyComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/bootstrap/planner',
        loadComponent: () => import('@app/universe/bootstrap/bootstrap-planner.component').then(m => m.BootstrapPlannerComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/bootstrap/chainstates',
        loadComponent: () => import('@app/universe/bootstrap/bootstrap-chainstates.component').then(m => m.BootstrapChainstatesComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 6: MuSig2, Multisig Setup, and Wallet Policy Interoperability Center
      {
        path: 'tools/multiparty',
        loadComponent: () => import('@app/universe/multiparty/multiparty-overview.component').then(m => m.MultipartyOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/multiparty/musig2',
        loadComponent: () => import('@app/universe/multiparty/multiparty-musig2.component').then(m => m.MultipartyMusig2Component),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/multiparty/musig2/session/:sessionId',
        loadComponent: () => import('@app/universe/multiparty/multiparty-session.component').then(m => m.MultipartySessionComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/multiparty/bsms',
        loadComponent: () => import('@app/universe/multiparty/multiparty-bsms.component').then(m => m.MultipartyBsmsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/multiparty/policies',
        loadComponent: () => import('@app/universe/multiparty/multiparty-policies.component').then(m => m.MultipartyPoliciesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/multiparty/labels',
        loadComponent: () => import('@app/universe/multiparty/multiparty-labels.component').then(m => m.MultipartyLabelsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/multiparty/compatibility',
        loadComponent: () => import('@app/universe/multiparty/multiparty-compatibility.component').then(m => m.MultipartyCompatibilityComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 7: Decentralized Mining Sharechain and Template-Autonomy Observatory
      {
        path: 'mining/decentralized',
        loadComponent: () => import('@app/universe/mining-decentralized/decentralized-mining-overview.component').then(m => m.DecentralizedMiningOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mining/decentralized/datum',
        loadComponent: () => import('@app/universe/mining-decentralized/decentralized-mining-datum.component').then(m => m.DecentralizedMiningDatumComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mining/decentralized/p2pool',
        loadComponent: () => import('@app/universe/mining-decentralized/decentralized-mining-p2pool.component').then(m => m.DecentralizedMiningP2poolComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mining/decentralized/braidpool',
        loadComponent: () => import('@app/universe/mining-decentralized/decentralized-mining-braidpool.component').then(m => m.DecentralizedMiningBraidpoolComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mining/decentralized/share/:shareId',
        loadComponent: () => import('@app/universe/mining-decentralized/decentralized-mining-share-detail.component').then(m => m.DecentralizedMiningShareDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mining/decentralized/compare',
        loadComponent: () => import('@app/universe/mining-decentralized/decentralized-mining-compare.component').then(m => m.DecentralizedMiningCompareComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 8: Nostr and Lightning Payment Connectivity Center
      {
        path: 'payments',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-connectivity-overview.component').then(m => m.PaymentConnectivityOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/nwc',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-nwc.component').then(m => m.PaymentNwcComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/nwc/inspect',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-nwc-inspect.component').then(m => m.PaymentNwcInspectComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/nwc/compatibility',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-nwc-compatibility.component').then(m => m.PaymentNwcCompatibilityComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/lnurl',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-lnurl.component').then(m => m.PaymentLnurlComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/lightning-address',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-lightning-address.component').then(m => m.PaymentLightningAddressComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'payments/zaps',
        loadComponent: () => import('@app/universe/payment-connectivity/payment-zaps.component').then(m => m.PaymentZapsComponent),
        data: { networks: ['bitcoin'] },
      },
      // Product 9: Bitcoin Staking, Finality, and Slashing Evidence Observatory
      {
        path: 'protocols/bitcoin-staking',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-overview.component').then(m => m.StakingOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/delegations',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-delegations.component').then(m => m.StakingDelegationsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/delegation/:delegationId',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-delegation-detail.component').then(m => m.StakingDelegationDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/finality-providers',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-finality-providers.component').then(m => m.StakingFinalityProvidersComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/finality-provider/:providerId',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-finality-provider-detail.component').then(m => m.StakingFinalityProviderDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/parameters',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-parameters.component').then(m => m.StakingParametersComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/evidence',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-evidence.component').then(m => m.StakingEvidenceComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'protocols/bitcoin-staking/reconciliation',
        loadComponent: () => import('@app/universe/bitcoin-staking/staking-reconciliation.component').then(m => m.StakingReconciliationComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'utxo-set',
        loadComponent: () => import('@app/universe/utxo-set/utxo-set.component').then(m => m.UtxoSetComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'utreexo',
        loadComponent: () => import('@app/universe/utxo-set/utxo-set.component').then(m => m.UtxoSetComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'source',
        loadComponent: () => import('@app/universe/source-page/source-page.component').then(m => m.SourcePageComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'outpoint/:txid/:vout',
        loadComponent: () => import('@app/universe/outpoint/outpoint.component').then(m => m.OutpointComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        // Where one transaction's value came from and went, drawn and
        // stated as a table, with replacement and package edges the node
        // actually reported.
        path: 'graph/tx/:txid',
        loadComponent: () => import('@app/universe/provenance-graph/provenance-graph.component').then(m => m.ProvenanceGraphComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'pulse',
        loadComponent: () => import('@app/universe/pulse/pulse.component').then(m => m.PulseComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        // The cross chain live view: everything this deployment's stream
        // delivers, with pause, scrub, and replay over what this page has
        // actually received.
        path: 'live',
        loadComponent: () => import('@app/universe/live/live-universe.component').then(m => m.LiveUniverseComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        // The mining and consensus lab: intervals, empty blocks, pool
        // shares, the AuxPoW proof parsed in the browser, and the stale
        // tips this node has seen.
        path: 'labs/mining',
        loadComponent: () => import('@app/universe/mining-lab/mining-lab.component').then(m => m.MiningLabComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/mining/bitcoin',
        loadComponent: () => import('@app/universe/mining-lab/bitcoin-mining.component').then(m => m.BitcoinMiningComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'labs/mining/dogecoin',
        loadComponent: () => import('@app/universe/mining-lab/dogecoin-mining.component').then(m => m.DogecoinMiningComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/mining/reorgs',
        loadComponent: () => import('@app/universe/mining-lab/reorgs.component').then(m => m.ReorgsComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      // Clusters, packages and the fee rate diagram. The list serves both
      // /mempool/clusters and /mempool/packages, and the detail view serves
      // both a cluster id and a transaction's package, because those are the
      // same object reached two ways.
      {
        path: 'mempool/clusters',
        loadComponent: () => import('@app/universe/mempool-intelligence/cluster-list.component').then(m => m.ClusterListComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'mempool/clusters/:clusterId',
        loadComponent: () => import('@app/universe/mempool-intelligence/cluster-detail.component').then(m => m.ClusterDetailComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'mempool/packages',
        loadComponent: () => import('@app/universe/mempool-intelligence/cluster-list.component').then(m => m.ClusterListComponent),
        data: { networkSpecific: true, networks: ['bitcoin'], packagesOnly: true },
      },
      {
        path: 'mempool/feerate-diagram',
        loadComponent: () => import('@app/universe/mempool-intelligence/feerate-diagram.component').then(m => m.FeerateDiagramComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      // Prices both routes to a higher fee rate. The target lives in the
      // query string so a plan can be linked to, and the page picks no rate
      // of its own, because the right one depends on how soon somebody needs
      // the transaction and nothing here knows that.
      {
        path: 'tx/:txid/bump',
        loadComponent: () => import('@app/universe/mempool-intelligence/bump.component').then(m => m.BumpComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'tx/:txid/package',
        loadComponent: () => import('@app/universe/mempool-intelligence/cluster-detail.component').then(m => m.ClusterDetailComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'saved',
        loadComponent: () => import('@app/universe/saved/saved.component').then(m => m.SavedComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        // Captured by the service worker at install, so it opens with no
        // network at all and carries the storage controls with it.
        path: 'offline',
        loadComponent: () => import('@app/universe/pwa/offline-page.component').then(m => m.OfflinePageComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        // The share target the manifest names. Everything the operating
        // system hands the explorer lands here first.
        path: 'share',
        loadComponent: () => import('@app/universe/pwa/share-receiver.component').then(m => m.ShareReceiverComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'portfolio',
loadChildren: () => import('@app/universe/portfolio/portfolio.routes').then(m => m.PORTFOLIO_ROUTES),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'inscription/:reference',
        loadComponent: () => import('@app/universe/inscription/inscription.component').then(m => m.InscriptionComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'rune/:reference',
        loadComponent: () => import('@app/universe/rune/rune.component').then(m => m.RuneComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'sat/:reference',
        loadComponent: () => import('@app/universe/sat/sat.component').then(m => m.SatComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'tools/calculator',
        component: CalculatorComponent
      },
      // Reads a partially signed transaction field by field, in the browser.
      // It makes no request and cannot sign, which is what lets it be handed
      // a file somebody is about to put a key to.
      // What the node behind this explorer is, and the read only methods it
      // will answer. The catalog comes from the server rather than being
      // repeated here, so the page cannot claim a method the server refuses.
      {
        path: 'node',
        loadComponent: () => import('@app/universe/node-console/node-overview.component').then(m => m.NodeOverviewComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'node/rpc',
        loadComponent: () => import('@app/universe/node-console/node-rpc.component').then(m => m.NodeRpcComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      // What a transaction's shape gives away. Both entry points run every
      // rule in the browser; the raw hex one makes no request at all, which
      // is what makes it usable for a transaction not yet broadcast.
      {
        path: 'labs/privacy',
        loadComponent: () => import('@app/universe/labs/privacy/privacy-lab.component').then(m => m.PrivacyLabComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'labs/privacy/:txid',
        loadComponent: () => import('@app/universe/labs/privacy/privacy-lab.component').then(m => m.PrivacyLabComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      // Asks the node what it would do with a package. It lives under tools
      // rather than under mempool because it is about a package somebody
      // holds, not about one the mempool already has.
      {
        path: 'tools/package',
        loadComponent: () => import('@app/universe/mempool-intelligence/package-simulator.component').then(m => m.PackageSimulatorComponent),
        data: { networkSpecific: true, networks: ['bitcoin'] },
      },
      {
        path: 'tools/psbt',
        loadComponent: () => import('@app/universe/workbench/psbt-workbench.component').then(m => m.PsbtWorkbenchComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      // The raw transaction analyser has lived at /tx/preview since before
      // there was a tools section. It is the same page under both addresses
      // rather than a second copy, so the two cannot drift apart.
      {
        path: 'tools/transaction',
        redirectTo: 'tx/preview',
        pathMatch: 'full',
      },
      // Frontier Product 1: Cross-Layer Atomic Swap and Submarine Swap Verification Center
      {
        path: 'swaps',
        loadComponent: () => import('@app/universe/swaps/swaps-overview.component').then(m => m.SwapsOverviewComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/submarine',
        loadComponent: () => import('@app/universe/swaps/swaps-submarine.component').then(m => m.SwapsSubmarineComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/reverse',
        loadComponent: () => import('@app/universe/swaps/swaps-reverse.component').then(m => m.SwapsReverseComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/chain',
        loadComponent: () => import('@app/universe/swaps/swaps-chain.component').then(m => m.SwapsChainComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/providers',
        loadComponent: () => import('@app/universe/swaps/swaps-providers.component').then(m => m.SwapsProvidersComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/provider/:providerId',
        loadComponent: () => import('@app/universe/swaps/swaps-provider-detail.component').then(m => m.SwapsProviderDetailComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/inspect',
        loadComponent: () => import('@app/universe/swaps/swaps-inspect.component').then(m => m.SwapsInspectComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/recover',
        loadComponent: () => import('@app/universe/swaps/swaps-recover.component').then(m => m.SwapsRecoverComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },
      {
        path: 'swaps/simulate',
        loadComponent: () => import('@app/universe/swaps/swaps-simulate.component').then(m => m.SwapsSimulateComponent),
        data: { networks: ['bitcoin', 'liquid'] },
      },

      // Frontier Product 2: Ark V-PACK, VTXO Portability, and Unilateral Exit Center
      {
        path: 'ark/vpack',
        loadComponent: () => import('@app/universe/ark-vpack/ark-vpack-overview.component').then(m => m.ArkVpackOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/vpack/verify',
        loadComponent: () => import('@app/universe/ark-vpack/ark-vpack-verify.component').then(m => m.ArkVpackVerifyComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/vpack/translate',
        loadComponent: () => import('@app/universe/ark-vpack/ark-vpack-translate.component').then(m => m.ArkVpackTranslateComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/vtxo/:vtxoId',
        loadComponent: () => import('@app/universe/ark-vpack/ark-vtxo-detail.component').then(m => m.ArkVtxoDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/backups',
        loadComponent: () => import('@app/universe/ark-vpack/ark-backups.component').then(m => m.ArkBackupsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/exit',
        loadComponent: () => import('@app/universe/ark-vpack/ark-exit.component').then(m => m.ArkExitComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/exit/simulate',
        loadComponent: () => import('@app/universe/ark-vpack/ark-exit-simulate.component').then(m => m.ArkExitSimulateComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'ark/providers',
        loadComponent: () => import('@app/universe/ark-vpack/ark-providers.component').then(m => m.ArkProvidersComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 3: Lightning HTLC/PTLC Congestion and Jamming Resilience Center
      {
        path: 'lightning/resilience',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-overview.component').then(m => m.LightningResilienceOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/resilience/htlcs',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-htlcs.component').then(m => m.LightningResilienceHtlcsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/resilience/onion-messages',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-onion.component').then(m => m.LightningResilienceOnionComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/resilience/channel/:shortId',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-channel-detail.component').then(m => m.LightningResilienceChannelDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/resilience/node/:publicKey',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-node-detail.component').then(m => m.LightningResilienceNodeDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/resilience/simulate',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-simulate.component').then(m => m.LightningResilienceSimulateComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'lightning/resilience/mitigations',
        loadComponent: () => import('@app/universe/lightning-resilience/lightning-resilience-mitigations.component').then(m => m.LightningResilienceMitigationsComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 4: Block Propagation, Compact-Block Reconstruction, and Fork-Race Observatory
      {
        path: 'network/blocks',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-overview.component').then(m => m.BlockPropagationOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/blocks/live',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-live.component').then(m => m.BlockPropagationLiveComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/blocks/:blockHash',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-block-detail.component').then(m => m.BlockPropagationBlockDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/compact-blocks',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-compact-blocks.component').then(m => m.BlockPropagationCompactBlocksComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/fork-races',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-fork-races.component').then(m => m.BlockPropagationForkRacesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/fork-races/:raceId',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-race-detail.component').then(m => m.BlockPropagationRaceDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/stale-tips',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-stale-tips.component').then(m => m.BlockPropagationStaleTipsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'network/fibre',
        loadComponent: () => import('@app/universe/block-propagation/block-propagation-fibre.component').then(m => m.BlockPropagationFibreComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 5: Private Transaction Submission, Accelerator, and Ordering Evidence Center
      {
        path: 'mempool/submission',
        loadComponent: () => import('@app/universe/private-submission/private-submission-overview.component').then(m => m.PrivateSubmissionOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mempool/private-broadcast',
        loadComponent: () => import('@app/universe/private-submission/private-submission-broadcast.component').then(m => m.PrivateSubmissionBroadcastComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mempool/accelerators',
        loadComponent: () => import('@app/universe/private-submission/private-submission-accelerators.component').then(m => m.PrivateSubmissionAcceleratorsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mempool/accelerator/:providerId',
        loadComponent: () => import('@app/universe/private-submission/private-submission-accelerator-detail.component').then(m => m.PrivateSubmissionAcceleratorDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'mempool/receipts',
        loadComponent: () => import('@app/universe/private-submission/private-submission-receipts.component').then(m => m.PrivateSubmissionReceiptsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/ordering',
        loadComponent: () => import('@app/universe/private-submission/private-submission-ordering.component').then(m => m.PrivateSubmissionOrderingComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/ordering/tx/:txid',
        loadComponent: () => import('@app/universe/private-submission/private-submission-ordering-tx.component').then(m => m.PrivateSubmissionOrderingTxComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/ordering/block/:blockHash',
        loadComponent: () => import('@app/universe/private-submission/private-submission-ordering-block.component').then(m => m.PrivateSubmissionOrderingBlockComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 6: OpenTimestamps and Bitcoin Proof-of-Publication Center
      {
        path: 'tools/timestamp',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-overview.component').then(m => m.OpenTimestampsOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/timestamp/stamp',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-stamp.component').then(m => m.OpenTimestampsStampComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/timestamp/verify',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-verify.component').then(m => m.OpenTimestampsVerifyComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/timestamp/inspect',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-inspect.component').then(m => m.OpenTimestampsInspectComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'tools/timestamp/git',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-git.component').then(m => m.OpenTimestampsGitComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/timestamps',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-overview.component').then(m => m.OpenTimestampsOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/timestamps/calendars',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-calendars.component').then(m => m.OpenTimestampsCalendarsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'intelligence/timestamps/batches',
        loadComponent: () => import('@app/universe/opentimestamps/opentimestamps-batches.component').then(m => m.OpenTimestampsBatchesComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 7: Bitcoin Consensus Conformance, Differential Validation, and Formal Verification Center
      {
        path: 'labs/consensus/conformance',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-overview.component').then(m => m.ConsensusConformanceOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/differential',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-differential.component').then(m => m.ConsensusConformanceDifferentialComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/cases',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-cases.component').then(m => m.ConsensusConformanceCasesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/case/:caseId',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-case-detail.component').then(m => m.ConsensusConformanceCaseDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/formal',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-formal.component').then(m => m.ConsensusConformanceFormalComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/specifications',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-specifications.component').then(m => m.ConsensusConformanceSpecificationsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'labs/consensus/corpora',
        loadComponent: () => import('@app/universe/consensus-conformance/consensus-conformance-corpora.component').then(m => m.ConsensusConformanceCorporaComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 8: Node Software Security, Advisory, and Upgrade Readiness Center
      {
        path: 'node/security',
        loadComponent: () => import('@app/universe/node-security/node-security-overview.component').then(m => m.NodeSecurityOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/fleet',
        loadComponent: () => import('@app/universe/node-security/node-security-fleet.component').then(m => m.NodeSecurityFleetComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/node/:nodeId',
        loadComponent: () => import('@app/universe/node-security/node-security-node-detail.component').then(m => m.NodeSecurityNodeDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/advisories',
        loadComponent: () => import('@app/universe/node-security/node-security-advisories.component').then(m => m.NodeSecurityAdvisoriesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/advisory/:advisoryId',
        loadComponent: () => import('@app/universe/node-security/node-security-advisory-detail.component').then(m => m.NodeSecurityAdvisoryDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/releases',
        loadComponent: () => import('@app/universe/node-security/node-security-releases.component').then(m => m.NodeSecurityReleasesComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/artifacts',
        loadComponent: () => import('@app/universe/node-security/node-security-artifacts.component').then(m => m.NodeSecurityArtifactsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/upgrade',
        loadComponent: () => import('@app/universe/node-security/node-security-upgrade.component').then(m => m.NodeSecurityUpgradeComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'node/security/configuration',
        loadComponent: () => import('@app/universe/node-security/node-security-configuration.component').then(m => m.NodeSecurityConfigurationComponent),
        data: { networks: ['bitcoin'] },
      },

      // Frontier Product 9: Collaborative Transaction and CoinJoin Protocol Verification Center
      {
        path: 'privacy/collaborative',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-overview.component').then(m => m.CollaborativePrivacyOverviewComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/inspect',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-inspect.component').then(m => m.CollaborativePrivacyInspectComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/wabisabi',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-wabisabi.component').then(m => m.CollaborativePrivacyWabisabiComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/joinmarket',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-joinmarket.component').then(m => m.CollaborativePrivacyJoinmarketComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/whirlpool',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-whirlpool.component').then(m => m.CollaborativePrivacyWhirlpoolComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/coordinators',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-coordinators.component').then(m => m.CollaborativePrivacyCoordinatorsComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/round/:roundId',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-round-detail.component').then(m => m.CollaborativePrivacyRoundDetailComponent),
        data: { networks: ['bitcoin'] },
      },
      {
        path: 'privacy/collaborative/fidelity-bonds',
        loadComponent: () => import('@app/universe/collaborative-privacy/collaborative-privacy-fidelity-bonds.component').then(m => m.CollaborativePrivacyFidelityBondsComponent),
        data: { networks: ['bitcoin'] },
      }
    ],
  }
];

if (window['__env']?.OFFICIAL_MEMPOOL_SPACE) {
  routes[0].children.push({
    path: 'monitoring',
    data: { networks: ['bitcoin', 'liquid'] },
    component: ServerHealthComponent
  });
  routes[0].children.push({
    path: 'nodes',
    data: { networks: ['bitcoin', 'liquid'] },
    component: ServerStatusComponent
  });
  if (window['isMempoolSpaceBuild']) {
    routes[0].children.push({
      path: 'faucet',
      canActivate: [(route: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
        return state.url.startsWith('/testnet4/');
      }],
      component: StartComponent,
      data: { preload: true, networkSpecific: true },
      children: [{
        path: '',
        data: { networks: ['bitcoin'] },
        component: FaucetComponent,
      }]
    });
  }
}

if (window['__env']?.customize?.dashboard?.widgets?.some(w => w.component ==='simpleproof')) {
  routes[0].children.push({
    path: 'sp/verified',
    component: SimpleProofWidgetComponent,
  });
}

if (window['__env']?.customize?.dashboard?.widgets?.some(w => w.component ==='simpleproof_cubo')) {
  routes[0].children.push({
    path: 'sp/cubo',
    component: SimpleProofCuboWidgetComponent,
  });
}

@NgModule({
  imports: [
    RouterModule.forChild(routes)
  ],
  exports: [
    RouterModule
  ]
})
export class MasterPageRoutingModule { }

@NgModule({
  imports: [
    CommonModule,
    MasterPageRoutingModule,
    SharedModule,
    ChainSyncNoticeComponent,
    ConnectivityBannerComponent,
    CommandPaletteComponent,
  ],
  declarations: [
    MasterPageComponent,
  ],
  exports: [
    MasterPageComponent,
  ]
})
export class MasterPageModule { }
