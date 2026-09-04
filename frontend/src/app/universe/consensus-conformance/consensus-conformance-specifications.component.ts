import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-consensus-conformance-specifications',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Bitcoin Consensus BIP Specifications</h1>
          <p class="text-muted mb-0">Unambiguous formal definitions of Bitcoin Improvement Proposals governing valid state transitions.</p>
        </div>
        <a routerLink="/labs/consensus/conformance" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Target BIP Standards</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>BIP Number</th>
                <th>Title</th>
                <th>Layer</th>
                <th>Formal Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let spec of bipSpecs">
                <td class="font-monospace fw-bold text-info">{{ spec.bip }}</td>
                <td>{{ spec.title }}</td>
                <td><span class="badge bg-secondary">{{ spec.layer }}</span></td>
                <td><span class="badge bg-success">{{ spec.formal_status }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceSpecificationsComponent {
  public bipSpecs = [
    { bip: 'BIP 340', title: 'Schnorr Signatures for secp256k1', layer: 'Consensus (Soft fork)', formal_status: 'Complete in Lean 4' },
    { bip: 'BIP 341', title: 'Taproot: Segregated Witness v1 Spending Rules', layer: 'Consensus (Soft fork)', formal_status: 'Complete in Coq' },
    { bip: 'BIP 342', title: 'Validation of Taproot Scripts (Tapscript)', layer: 'Consensus (Soft fork)', formal_status: 'Under Verification' },
    { bip: 'BIP 141', title: 'Segregated Witness (Consensus layer)', layer: 'Consensus (Soft fork)', formal_status: 'Complete' },
  ];
}
