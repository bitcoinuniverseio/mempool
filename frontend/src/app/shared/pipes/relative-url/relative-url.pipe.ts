import { Pipe, PipeTransform, inject } from '@angular/core';
import { StateService } from '@app/services/state.service';

/**
 * Resolved outside the constructor: in the running app the StateService
 * already exists; in a component test that provides none, the pipe renders
 * the plain path instead of failing the whole template.
 */
function resolveStateService(): StateService | null {
  try {
    return inject(StateService, { optional: true });
  } catch {
    return null;
  }
}

@Pipe({
  name: 'relativeUrl',
  standalone: true,
})
export class RelativeUrlPipe implements PipeTransform {

  private stateService = resolveStateService();

  transform(value: string, swapNetwork?: string): string {
    if (!this.stateService) {return value;}
    const env = this.stateService.env ?? { ROOT_NETWORK: 'mainnet', BASE_MODULE: 'mempool' };
    let network = swapNetwork || this.stateService.network;
    if (network === 'mainnet' || network === env.ROOT_NETWORK) {
      network = '';
    }
    if (env.BASE_MODULE === 'liquid' && network === 'liquidtestnet') {
      network = 'testnet';
    } else if (env.BASE_MODULE !== 'mempool') {
      network = '';
    }
    return (network ? '/' + network : '') + value;
  }

}
