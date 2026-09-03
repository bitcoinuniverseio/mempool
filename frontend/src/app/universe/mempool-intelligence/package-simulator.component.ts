import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { UniverseApiService } from '@app/universe/universe-api.service';
import { PackageSimulation } from './mempool-intelligence.types';
import {
  blocksAhead,
  formatOptionalFeerate,
  Headline,
  headlineFor,
  MAX_PACKAGE_SIZE,
  splitRawTransactions,
} from './package-input';
import { formatFeerate, formatSats, formatVsize, shorten } from './cluster-format';
import { looksLikeSecret } from '@app/universe/workbench/psbt-inspect';

/**
 * What this node would do with a package, before it is sent to one.
 *
 * The node answers the question that matters, through `testmempoolaccept`.
 * What this page adds is everything that answer leaves out: which transaction
 * is in the way, how much a replacement is short by, how the package groups,
 * and where that group would sit in the mempool as it stands.
 *
 * Nothing here broadcasts. Testing a package and sending one are different
 * actions and this page only does the first, so a paste can be examined
 * without committing to it.
 */
@Component({
  selector: 'app-package-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './package-simulator.component.html',
  styleUrls: ['./package-simulator.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PackageSimulatorComponent implements OnInit, OnDestroy {
  input = '';
  simulation: PackageSimulation | null = null;
  headline: Headline | null = null;
  /** Set when the paste could not be read, before anything was sent. */
  inputError: string | null = null;
  /** Set when the request failed, carrying what the server said. */
  requestError: string | null = null;
  secretWarning: string | null = null;
  running = false;

  readonly maxPackageSize = MAX_PACKAGE_SIZE;

  private subscription: Subscription | null = null;

  constructor(
    private api: UniverseApiService,
    private seo: SeoService,
    private cd: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@mempool.simulate.title:Package simulator`);
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /**
   * Reads the box and asks the node.
   *
   * The secret check runs first. This page does send what is pasted to the
   * server, unlike the PSBT workbench, so a mistaken paste of key material
   * has to be stopped before the request and not after it.
   */
  run(): void {
    this.reset();
    const secret = looksLikeSecret(this.input);
    if (secret) {
      this.secretWarning = secret;
      this.input = '';
      return;
    }
    const split = splitRawTransactions(this.input);
    if (split.error) {
      this.inputError = split.error;
      return;
    }
    this.running = true;
    this.subscription?.unsubscribe();
    this.subscription = this.api.simulatePackage$(split.rawTxs).subscribe({
      next: (simulation) => {
        this.simulation = simulation;
        this.headline = headlineFor(simulation);
        this.running = false;
        this.cd.markForCheck();
      },
      error: (error) => {
        this.running = false;
        // The server states what was wrong with a package it could not read,
        // and passing that through is more useful than replacing it with a
        // sentence of this page's own.
        this.requestError = typeof error?.error === 'string' && error.error.length < 400
          ? error.error
          : $localize`:@@mempool.simulate.failed:This node could not be asked about that package.`;
        this.cd.markForCheck();
      },
    });
  }

  clear(): void {
    this.input = '';
    this.reset();
  }

  private reset(): void {
    this.simulation = null;
    this.headline = null;
    this.inputError = null;
    this.requestError = null;
    this.secretWarning = null;
  }

  sats(value: number | null): string {
    return value === null ? $localize`:@@mempool.simulate.fee-unknown:unknown` : formatSats(value);
  }

  vsize(value: number): string {
    return formatVsize(value);
  }

  rate(value: number | null): string {
    return formatOptionalFeerate(value);
  }

  exactRate(value: number): string {
    return formatFeerate(value);
  }

  short(value: string): string {
    return shorten(value);
  }

  blocks(vsizeAhead: number): number {
    return blocksAhead(vsizeAhead);
  }

  trackByTxid(_index: number, tx: { txid: string }): string {
    return tx.txid;
  }

  trackByOutpoint(_index: number, conflict: { outpoint: string }): string {
    return conflict.outpoint;
  }

  trackByIndex(index: number): number {
    return index;
  }
}
