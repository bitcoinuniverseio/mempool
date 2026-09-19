import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ProtocolBadgeComponent } from '@app/universe/protocol-badge/protocol-badge.component';
import { AssetFlowComponent } from '@app/universe/asset-flow/asset-flow.component';

/**
 * Universe presentation pieces that other feature modules embed. Kept separate
 * from UniverseModule so importing them never pulls in the lazy route table.
 */
/**
 * IMPLEMENTATION-HANDOFF [TX-06] TX-06-FE-SHARED
 * Coverage G01/G13/G14/G15; D01/D09/D11. R-USER/R-ANGULAR-20.
 * Current shared exports contain the flow and text badge only.
 * 1. Declare/export the proposed TransactionAssetsComponent and any exact
 * quantity/asset-logo presentation dependencies here, not only in the lazy
 * protocol directory. Keep the public inputs context/txid/status explicit.
 * 2. Import this module in TrackerModule and the standalone multichain/Fractal
 * transaction consumers. Verify TransactionModule does not duplicate component
 * declarations. Do not import a lazy routing module to make a badge available.
 * 3. Reuse the local design tokens and bundled protocol-icon catalogue. Add
 * one guarded logo failure fallback; local icon absence gets a labelled generic
 * asset icon, not a broken image or invented verified token logo.
 * Depends TX-01/04/05/06/07. Tests: frontend Vitest transaction-assets component
 * spec, existing asset-flow spec and route smoke for details/status/Doge/Zcash/
 * Fractal. Run Angular compilation to catch scope/import/template errors; a
 * pure model unit test alone does not prove the template renders.
 * No behavior changes here until implementation; no generated/vendor edits.
 */
@NgModule({
  declarations: [
    ProtocolBadgeComponent,
    AssetFlowComponent,
  ],
  imports: [
    CommonModule,
    RouterModule,
  ],
  exports: [
    ProtocolBadgeComponent,
    AssetFlowComponent,
  ],
})
export class UniverseSharedModule { }
