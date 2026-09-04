import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-consensus-conformance-corpora',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Differential Fuzzing Corpora & Test Suites</h1>
          <p class="text-muted mb-0">High-coverage seed corpuses from libFuzzer, AFL++, and historical Bitcoin mainnet reorganization events.</p>
        </div>
        <a routerLink="/labs/consensus/conformance" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Corpora Catalogs</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Corpus Dataset</th>
                <th>File Count</th>
                <th>Branch Coverage</th>
                <th>Primary Engine Target</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of corpora">
                <td class="fw-bold text-info">{{ c.name }}</td>
                <td>{{ c.files | number }} files</td>
                <td class="text-success">{{ c.coverage }}%</td>
                <td><code>{{ c.target }}</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class ConsensusConformanceCorporaComponent {
  public corpora = [
    { name: 'Bitcoin Core Script Fuzz Corpus', files: 45200, coverage: 98.4, target: 'EvalScript / VerifyScript' },
    { name: 'Raw Block Deserialization Mutants', files: 12800, coverage: 94.2, target: 'CBlock::Unserialize' },
    { name: 'Taproot Annex Malformations', files: 8900, coverage: 96.1, target: 'ExecuteWitnessScript' },
    { name: 'Historical Soft Fork Boundary Blocks', files: 120, coverage: 100.0, target: 'ConnectBlock / ContextualCheckBlock' },
  ];
}
