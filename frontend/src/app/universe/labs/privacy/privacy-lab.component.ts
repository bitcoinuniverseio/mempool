import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { ElectrsApiService } from '@app/services/electrs-api.service';
import { StateService } from '@app/services/state.service';
import { decodeRawTransaction } from '@app/shared/transaction.utils';
import { Transaction } from '@interfaces/electrs.interface';
import { looksLikeSecret } from '@app/universe/workbench/psbt-inspect';
import { isCoinbase, toPrivacyTransaction } from './privacy-map';
import { analyze, Finding, PrivacyReport, Severity } from './privacy-rules';

/**
 * What a transaction's shape gives away.
 *
 * Two ways in. A transaction id fetches the transaction from this node, which
 * is one request for one transaction and no record of who asked. Raw hex is
 * read entirely in the browser and never leaves it, which is the path for
 * anything not yet broadcast.
 *
 * Every rule runs in the browser either way. Nothing is stored, no address is
 * profiled, and no finding names a person: the question is what a transaction
 * reveals about itself, not who made it.
 */
@Component({
  selector: 'app-privacy-lab',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './privacy-lab.component.html',
  styleUrls: ['./privacy-lab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyLabComponent implements OnInit, OnDestroy {
  txid = '';
  rawInput = '';
  report: PrivacyReport | null = null;
  /** True when the report came from hex read in this browser. */
  fromLocalRaw = false;
  coinbase = false;
  error: string | null = null;
  secretWarning: string | null = null;
  loading = false;
  showSkipped = false;

  private routeSubscription: Subscription | null = null;
  private txSubscription: Subscription | null = null;

  constructor(
    private electrs: ElectrsApiService,
    private state: StateService,
    private seo: SeoService,
    private route: ActivatedRoute,
    private router: Router,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@labs.privacy.title:Privacy lab`);
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const txid = params.get('txid');
      if (txid) {
        this.txid = txid;
        this.loadFromNode(txid);
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    this.txSubscription?.unsubscribe();
  }

  private loadFromNode(txid: string): void {
    this.reset();
    this.loading = true;
    this.txSubscription?.unsubscribe();
    this.txSubscription = this.electrs.getTransaction$(txid).subscribe({
      next: (tx) => {
        this.apply(tx, false);
        this.loading = false;
        this.cd.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.error = $localize`:@@labs.privacy.not-found:This node does not have that transaction.`;
        this.cd.markForCheck();
      },
    });
  }

  /** Navigates, which is what then loads. Keeps the address meaningful. */
  lookup(txid: string): void {
    const clean = (txid ?? '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(clean)) {
      this.error = $localize`:@@labs.privacy.bad-txid:A transaction id is 64 hexadecimal characters.`;
      return;
    }
    this.router.navigate(['/labs/privacy', clean]);
  }

  /**
   * Reads raw hex in the browser.
   *
   * This path makes no request at all, which is what makes it usable for a
   * transaction that has not been broadcast and should not be.
   */
  analyzeRaw(): void {
    this.reset();
    const secret = looksLikeSecret(this.rawInput);
    if (secret) {
      this.secretWarning = secret;
      this.rawInput = '';
      return;
    }
    const hex = this.rawInput.trim().replace(/\s+/g, '');
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 120) {
      this.error = $localize`:@@labs.privacy.bad-raw:That is not a raw transaction in hexadecimal.`;
      return;
    }
    try {
      const { tx } = decodeRawTransaction(hex, this.state.network);
      this.apply(tx as Transaction, true);
    } catch (e) {
      this.error = e instanceof Error
        ? e.message
        : $localize`:@@labs.privacy.undecodable:That could not be read as a transaction.`;
    }
  }

  private apply(tx: Transaction, local: boolean): void {
    this.txid = tx.txid;
    this.fromLocalRaw = local;
    this.coinbase = isCoinbase(tx);
    this.report = analyze(toPrivacyTransaction(tx));
  }

  private reset(): void {
    this.report = null;
    this.error = null;
    this.secretWarning = null;
    this.coinbase = false;
    this.fromLocalRaw = false;
  }

  toggleSkipped(): void {
    this.showSkipped = !this.showSkipped;
  }

  /** How many findings of each kind, for the summary line. */
  countOf(severity: Severity): number {
    return (this.report?.findings ?? []).filter((f) => f.severity === severity).length;
  }

  trackByRule(_index: number, finding: Finding): string {
    return finding.ruleId;
  }

  trackBySkipped(_index: number, skipped: { ruleId: string }): string {
    return skipped.ruleId;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
