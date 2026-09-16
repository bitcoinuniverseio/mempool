import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';
import { StateService } from '@app/services/state.service';

/**
 * Sends backend-owned API requests to the selected network's backend.
 *
 * The gateway dispatches `/api/v1/...` to the root backend and
 * `/signet/api/v1/...` (or testnet, testnet4) to that network's own backend,
 * calendar, index and record store. The explorer's own ApiService prefixes its
 * URLs that way; the Universe surfaces are served by dozens of small services
 * that each hold a `/api/v1/intelligence/...` base and did not. Rewriting the
 * request here, once, keeps every one of them on the selected network.
 *
 * Overlay families carry chain and network as query fields and reach the
 * overlay through the root prefix; the Fractal and Liquid families are their
 * own chains. Both are left alone.
 */
const OVERLAY_OR_OTHER_CHAIN = ['universe', 'chains', 'bitcoin', 'dogecoin', 'zcash', 'anima', 'fractal', 'liquid'];

@Injectable()
export class NetworkPrefixInterceptor implements HttpInterceptor {
  constructor(private stateService: StateService) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const url = networkScopedUrl(request.url, this.stateService);
    return next.handle(url === request.url ? request : request.clone({ url }));
  }
}

/** The URL a backend-owned request should use for the selected network, or the URL unchanged. */
export function networkScopedUrl(url: string, stateService: Pick<StateService, 'network' | 'env'>): string {
  const env = stateService.env;
  const network = stateService.network;
  if (!network || network === 'mainnet' || network === env?.ROOT_NETWORK || (env && env.BASE_MODULE !== 'mempool')) {return url;}
  // Relative, or absolute on the origin the SSR build names.
  const origin = env?.NGINX_HOSTNAME ? `${env.NGINX_PROTOCOL}://${env.NGINX_HOSTNAME}:${env.NGINX_PORT}` : '';
  const base = origin && url.startsWith(origin) ? origin : url.startsWith('/') ? '' : null;
  if (base === null) {return url;}
  const path = url.slice(base.length);
  const match = /^\/api\/v1\/([a-z0-9-]+)(?=[/?#]|$)/.exec(path);
  if (!match || OVERLAY_OR_OTHER_CHAIN.includes(match[1])) {return url;}
  return `${base}/${network}${path}`;
}
