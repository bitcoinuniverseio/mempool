import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';
export const LOCAL_RPC_EXAMPLE =
  '# Bitcoin Core 29 local RPC example only\n# Keep existing network/datadir selection explicit.\nserver=1\n# No rpcpassword or rpcauth: use default generated cookie credentials.\n# RPC defaults to loopback; review existing config/command-line overrides.\nrest=0';
@Component({
  selector: 'app-node-security-configuration',
  standalone: true,
  imports: [RouterModule, RelativeUrlPipe],
  template: ` <div class="container-xl py-4">
    <h1>Bitcoin Core Local RPC Configuration Example</h1>
    <a [routerLink]="'/node/security' | relativeUrl">Back to node security</a>
    <p>
      This example describes Bitcoin Core 29 defaults. It is not an audit of
      your installed version, network, operating system, effective configuration
      or resource limits.
    </p>
    <h2>Local cookie authentication</h2>
    <pre class="card p-3" style="white-space:pre-wrap" tabindex="0">{{
      example
    }}</pre>
    <p>
      With no configured RPC password, Core generates a fresh cookie credential
      at startup. Local clients need access to the correct network/datadir
      cookie under the node's operating-system account. Existing
      password/authentication overrides must be reviewed before using cookie
      authentication.
    </p>
    <p>
      RPC defaults to loopback. Review all configuration includes, command-line
      overrides and container port mappings before enabling it. This page has
      not inspected the effective listener or file permissions. It does not
      generate credentials or change your node.
    </p>
    <p>
      Choose memory budgets, peer settings and service startup options from the
      installed version's help and the actual host requirements. No production
      hardening verdict is established here.
    </p>
    <a
      href="https://github.com/bitcoin/bitcoin/blob/v29.0/doc/JSON-RPC-interface.md#security"
      target="_blank"
      rel="noopener noreferrer"
      >Bitcoin Core 29 RPC authentication and security documentation</a
    >
  </div>`,
})
export class NodeSecurityConfigurationComponent {
  example = LOCAL_RPC_EXAMPLE;
}
