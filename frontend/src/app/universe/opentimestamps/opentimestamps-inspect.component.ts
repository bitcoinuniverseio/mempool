import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

/**
 * The proof bytecode inspector.
 *
 * The revision this replaces rendered a fixed four-step operation stack, ending
 * in "Block 864201 Merkle Root Validated", with no proof loaded and no decoder
 * anywhere in the page. Whatever a reader pasted, they saw those four steps. A
 * decompiler that decompiles nothing says so.
 */
@Component({
  selector: 'app-opentimestamps-inspect',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">OpenTimestamps Proof Bytecode Inspector</h1>
          <p class="text-muted mb-0">Step through the cryptographic opcodes inside an OTS proof stream.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="alert alert-warning" role="alert">
        This deployment carries no OTS proof decoder yet, so no operation stack can be shown.
        Nothing here has been decoded, and no attestation here has been checked against Bitcoin.
      </div>
    </div>
  `
})
export class OpenTimestampsInspectComponent {}
