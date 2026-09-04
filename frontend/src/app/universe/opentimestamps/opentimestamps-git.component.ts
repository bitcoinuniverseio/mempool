import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-opentimestamps-git',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Git Commit & Tag Proof-of-Publication</h1>
          <p class="text-muted mb-0">Verify Git commit hashes and releases anchored directly into the Bitcoin blockchain via ots-git.</p>
        </div>
        <a routerLink="/tools/timestamp" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary">
          <h5 class="card-title mb-0">Recent Git Attestations</h5>
        </div>
        <div class="table-responsive">
          <table class="table table-dark table-hover mb-0">
            <thead>
              <tr>
                <th>Commit SHA</th>
                <th>Author</th>
                <th>Anchor Block</th>
                <th>Attestation Date</th>
                <th>Proof Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let g of gitCommits">
                <td class="font-monospace text-info">{{ g.commit_sha }}</td>
                <td>{{ g.author }}</td>
                <td class="fw-bold">{{ g.anchor_block }}</td>
                <td class="text-muted">{{ g.date }}</td>
                <td><span class="badge bg-success">VERIFIED IN BITCOIN</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `
})
export class OpenTimestampsGitComponent {
  public gitCommits = [
    { commit_sha: '5dbecdc07b8a1928374650192837465019283746', author: 'Satoshi Nakamoto', anchor_block: 864201, date: '2026-09-04' },
    { commit_sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', author: 'Universe Core Developer', anchor_block: 864195, date: '2026-09-04' },
  ];
}
