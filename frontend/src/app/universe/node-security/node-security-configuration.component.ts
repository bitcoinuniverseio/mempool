import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-node-security-configuration',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <div class="container-xl py-4">
      <div class="d-flex justify-content-between align-items-center mb-4 pb-2 border-bottom">
        <div>
          <h1 class="h2 mb-1">Hardened bitcoin.conf Configuration Generator</h1>
          <p class="text-muted mb-0">Best-practice security configurations protecting against RPC exposure, peer fingerprinting, and memory exhaustion.</p>
        </div>
        <a routerLink="/node/security" class="btn btn-outline-secondary btn-sm">Back to Overview</a>
      </div>

      <div class="card bg-dark border-secondary mb-4">
        <div class="card-header border-secondary d-flex justify-content-between align-items-center">
          <h5 class="card-title mb-0">Recommended Production Configuration</h5>
          <span class="badge bg-success">HARDENED</span>
        </div>
        <div class="card-body">
          <pre class="bg-black text-light p-3 rounded font-monospace small mb-0"><code># Bitcoin Core Hardened Production Configuration
# Network & Bindings
server=1
daemon=1
listen=1
maxconnections=64
listenonion=1

# Memory & Resource Limits
dbcache=4096
maxmempool=300
mempoolexpiry=72

# Security & RPC Isolation
rpcallowip=127.0.0.1
rpcbind=127.0.0.1:8332
rpcpassword=use_cookie_auth_instead
# Disable unauthenticated REST endpoints if not required
rest=0

# P2P Hardening
blocksonly=0
peerbloomfilters=0
v2transport=1</code></pre>
        </div>
      </div>
    </div>
  `
})
export class NodeSecurityConfigurationComponent {}
