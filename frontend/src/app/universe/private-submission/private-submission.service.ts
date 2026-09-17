import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { startWith, map, distinctUntilChanged } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import {
  SubmissionOverview,
  SubmissionCapabilities,
  SubmissionMethod,
  PrivateBroadcastRecord,
  AcceleratorProvider,
  PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER,
} from './private-submission.models';

function ownerHeaders(ownerToken?: string): Record<string, string> {
  return ownerToken ? { [PRIVATE_SUBMISSION_OWNER_TOKEN_HEADER]: ownerToken } : {};
}
export * from './private-submission.models';
export type PrivateBroadcastStatus = PrivateBroadcastRecord['status'];
/**
 * Reads for the private submission surfaces.
 *
 * Every call here returns what the intelligence API returned, or it errors.
 * There is deliberately no fallback value: an earlier revision answered a
 * failed request with an invented overview, an invented diagnosis, an invented
 * broadcast token whose status already read "relayed_to_pools", and an invented
 * receipt whose signature already read valid. A reader could not tell any of
 * those from a real answer, which is the one thing a submission and receipt
 * surface may never do. A request that does not reach the authority is an
 * error, and the surfaces say so.
 */
@Injectable({
  providedIn: 'root',
})
export class PrivateSubmissionApiService {
  get network(): string {
    return this.state.network || 'mainnet';
  }
  get network$(): Observable<string> {
    return this.state.networkChanged$.pipe(
      startWith(this.state.network),
      map((n) => n || 'mainnet'),
      distinctUntilChanged()
    );
  }
  private get baseUrl(): string {
    const host =
      !this.state.isBrowser && this.state.env
        ? this.state.env.NGINX_PROTOCOL +
          '://' +
          this.state.env.NGINX_HOSTNAME +
          ':' +
          this.state.env.NGINX_PORT
        : '';
    return (
      host +
      (this.state.network ? '/' + this.state.network : '') +
      '/api/v1/intelligence'
    );
  }

  constructor(
    private http: HttpClient,
    private state: StateService
  ) {}

  public getOverview$(): Observable<SubmissionOverview> {
    return this.http.get<SubmissionOverview>(
      `${this.baseUrl}/submission/overview`
    );
  }

  public diagnose$(txidOrHex: string): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/submission/diagnose`,
      /^[0-9a-f]{64}$/i.test(txidOrHex)
        ? { txid: txidOrHex }
        : { raw_tx: txidOrHex }
    );
  }

  public getCapabilities$(): Observable<SubmissionCapabilities> {
    return this.http.get<SubmissionCapabilities>(
      `${this.baseUrl}/submission/capabilities`
    );
  }

  public submitPrivate$(payload: {
    raw_tx: string;
    method: SubmissionMethod;
  }): Observable<PrivateBroadcastRecord> {
    return this.http.post<PrivateBroadcastRecord>(
      `${this.baseUrl}/submission/private`,
      payload
    );
  }

  /**
   * Readback and abort are owner-authenticated: the backend returns the owner
   * token once, on creation, and requires it back in a header. The token is
   * never placed in the URL.
   */
  public getPrivateSubmission$(
    token: string,
    ownerToken?: string
  ): Observable<PrivateBroadcastRecord> {
    return this.http.get<PrivateBroadcastRecord>(
      `${this.baseUrl}/submission/private/${encodeURIComponent(token)}`,
      { headers: ownerHeaders(ownerToken) }
    );
  }

  public abortPrivate$(
    token: string,
    ownerToken?: string
  ): Observable<{ success: boolean; status: string }> {
    return this.http.post<{ success: boolean; status: string }>(
      `${this.baseUrl}/submission/private/${encodeURIComponent(token)}/abort`,
      {},
      { headers: ownerHeaders(ownerToken) }
    );
  }

  /** The service contract is an envelope, { providers: [...] }, never a bare array. */
  public listAccelerators$(): Observable<{ providers: AcceleratorProvider[] }> {
    return this.http.get<{ providers: AcceleratorProvider[] }>(
      `${this.baseUrl}/accelerators/providers`
    );
  }

  public getAccelerator$(providerId: string): Observable<AcceleratorProvider> {
    return this.http.get<AcceleratorProvider>(
      `${this.baseUrl}/accelerators/providers/${encodeURIComponent(providerId)}`
    );
  }

  public verifyReceipt$(receiptPayload: any): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/accelerators/receipts/verify`,
      receiptPayload
    );
  }

  public getTxOrdering$(txid: string): Observable<any> {
    return this.http.get<any>(
      `${this.baseUrl}/ordering/transactions/${encodeURIComponent(txid)}`
    );
  }

  public getBlockOrdering$(blockHash: string): Observable<any> {
    return this.http.get<any>(
      `${this.baseUrl}/ordering/blocks/${encodeURIComponent(blockHash)}`
    );
  }

  public listOrderingFindings$(): Observable<any[]> {
    return this.http.get<any>(`${this.baseUrl}/ordering/findings`).pipe(
      map((x) => {
        if (!x || !Array.isArray(x.findings))
          throw Error('Malformed findings envelope.');
        return x.findings;
      })
    );
  }
}
