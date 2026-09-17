import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { startWith, map, distinctUntilChanged } from 'rxjs/operators';
import { StateService } from '@app/services/state.service';
import {
  SubmissionOverview,
  SubmissionCapabilities,
  SubmissionDiagnosisResult,
  SubmissionMethod,
  PrivateBroadcastRecord,
  AcceleratorProvider,
  AcceleratorDirectoryRef,
  BlockOrderingEvidence,
  OrderingFindings,
  ReceiptVerificationResult,
  TransactionOrderingEvidence,
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

  /** The transaction's own mempool facts, or a 404 transaction-not-in-mempool. */
  public diagnose$(txidOrHex: string): Observable<SubmissionDiagnosisResult> {
    return this.http.post<SubmissionDiagnosisResult>(
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

  /** The service contract is an envelope, { providers, network, directory }, never a bare array. */
  public listAccelerators$(): Observable<{ providers: AcceleratorProvider[]; network?: string; directory?: AcceleratorDirectoryRef }> {
    return this.http.get<{ providers: AcceleratorProvider[]; network?: string; directory?: AcceleratorDirectoryRef }>(
      `${this.baseUrl}/accelerators/providers`
    );
  }

  public getAccelerator$(providerId: string): Observable<AcceleratorProvider> {
    return this.http.get<AcceleratorProvider>(
      `${this.baseUrl}/accelerators/providers/${encodeURIComponent(providerId)}`
    );
  }

  /**
   * 200 only when the signature verified against the owned directory key;
   * 409 duplicate, 503 unavailable-trust and 400 for the other stages carry
   * the same result body in the error.
   */
  public verifyReceipt$(receiptPayload: any): Observable<ReceiptVerificationResult> {
    return this.http.post<ReceiptVerificationResult>(
      `${this.baseUrl}/accelerators/receipts/verify`,
      receiptPayload
    );
  }

  /** 404 transaction-not-observed when no retained block holds the transaction. */
  public getTxOrdering$(txid: string): Observable<TransactionOrderingEvidence> {
    return this.http.get<TransactionOrderingEvidence>(
      `${this.baseUrl}/ordering/transactions/${encodeURIComponent(txid)}`
    );
  }

  /** 404 block-not-observed when this backend did not record the block. */
  public getBlockOrdering$(blockHash: string): Observable<BlockOrderingEvidence> {
    return this.http.get<BlockOrderingEvidence>(
      `${this.baseUrl}/ordering/blocks/${encodeURIComponent(blockHash)}`
    );
  }

  /** The findings envelope with its state, coverage and retention. */
  public listOrderingFindings$(): Observable<OrderingFindings> {
    return this.http.get<OrderingFindings>(`${this.baseUrl}/ordering/findings`).pipe(
      map((x) => {
        if (!x || !Array.isArray(x.findings) || !['observed', 'no-blocks-observed'].includes(x.state))
          throw Error('Malformed findings envelope.');
        return x;
      })
    );
  }
}
