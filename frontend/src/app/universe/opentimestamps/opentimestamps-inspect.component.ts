import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-opentimestamps-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">OpenTimestamps Proof Bytecode Inspector</h1>
          <p class="text-muted mb-0">Decompile and step through individual cryptographic opcodes inside an OTS proof stream.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Decoded Operation Stack</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Step</th>
                <th>Opcode</th>
                <th>Argument Hex</th>
                <th>Result Digest</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let step of opStack">
                <td class="font-monospace text-muted">{{ step.step }}</td>
                <td><code class="text-warning">{{ step.opcode }}</code></td>
                <td class="font-monospace text-muted">{{ step.argument || 'N/A' }}</td>
                <td class="font-monospace text-info">{{ step.result }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsInspectComponent {
  public opStack = [
    { step: 1, opcode: 'TAG_SHA256', argument: '', result: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
    { step: 2, opcode: 'APPEND', argument: '616c696365', result: '9f8e7d6c5b4a392817263544fedcba09876543211234567890abcdef12345678' },
    { step: 3, opcode: 'SHA256', argument: '', result: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2' },
    { step: 4, opcode: 'ATTESTATION_BITCOIN_BLOCK_HEADER', argument: 'height=864201', result: 'Block 864201 Merkle Root Validated' },
  ];
}
