import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-consensus-conformance-differential',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Differential Fuzzing Matrix</h1>
          <p class="text-muted mb-0">Real-time cross-validation across reference C++ Bitcoin Core and alternative parser/script implementations.</p>
        </div>
        <a routerLink="/labs/consensus/conformance" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Consensus Verification Targets</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Subsystem Target</th>
                <th>Core v28</th>
                <th>btcd (Go)</th>
                <th>bcoin (JS)</th>
                <th>rust-bitcoin</th>
                <th>libbitcoin</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let t of targets">
                <td class="fw-bold">{{ t.subsystem }}</td>
                <td><span class="badge bg-success">100% MATCH</span></td>
                <td>
                  <span class="badge" [ngClass]="t.btcd === 'MATCH' ? 'bg-success' : 'bg-danger'">{{ t.btcd }}</span>
                </td>
                <td>
                  <span class="badge" [ngClass]="t.bcoin === 'MATCH' ? 'bg-success' : 'bg-warning text-dark'">{{ t.bcoin }}</span>
                </td>
                <td>
                  <span class="badge" [ngClass]="t.rust === 'MATCH' ? 'bg-success' : 'bg-danger'">{{ t.rust }}</span>
                </td>
                <td>
                  <span class="badge" [ngClass]="t.libbitcoin === 'MATCH' ? 'bg-success' : 'bg-secondary'">{{ t.libbitcoin }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceDifferentialComponent {
  public targets = [
    { subsystem: 'Transaction Serialization (BIP 144)', btcd: 'MATCH', bcoin: 'MATCH', rust: 'MATCH', libbitcoin: 'MATCH' },
    { subsystem: 'Tapscript Execution (BIP 342)', btcd: '1 DIVERGENCE', bcoin: '1 DIVERGENCE', rust: 'MATCH', libbitcoin: 'MATCH' },
    { subsystem: 'SegWit v0 Sighash (BIP 143)', btcd: 'MATCH', bcoin: 'MATCH', rust: 'MATCH', libbitcoin: 'MATCH' },
    { subsystem: 'Difficulty Adjustment & Retargeting', btcd: 'MATCH', bcoin: 'MATCH', rust: 'MATCH', libbitcoin: 'MATCH' },
    { subsystem: 'Timelock Enforcement (BIP 68 / 112)', btcd: 'MATCH', bcoin: 'MATCH', rust: 'MATCH', libbitcoin: 'MATCH' },
  ];
}
