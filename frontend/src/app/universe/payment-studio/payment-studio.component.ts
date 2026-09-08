import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { formatBtcAmountAsSats } from '@app/universe/universe-evidence';
import { UniverseIdentifierComponent } from '@app/universe/universe-identifier.component';

export interface Bip21Parsed {
  readonly address: string;
  readonly amountBtc?: string;
  readonly label?: string;
  readonly message?: string;
  readonly lightning?: string;
  readonly pj?: string;
  readonly silentPayment?: string;
}

export interface Bip353Result {
  readonly kind: 'invalid-input' | 'unavailable';
  readonly humanName: string;
  readonly message: string;
}

@Component({
  selector: 'app-payment-studio',
  templateUrl: './payment-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    UniverseIdentifierComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentStudioComponent {
  protected readonly formatBtcAmountAsSats = formatBtcAmountAsSats;
  bip21Uri = '';
  bip21Notice = '';
  bip353Name = '';

  private readonly parsedBip21Subject = new BehaviorSubject<Bip21Parsed | null>(
    null
  );
  readonly parsedBip21$: Observable<Bip21Parsed | null> =
    this.parsedBip21Subject.asObservable();

  private readonly bip353Subject = new BehaviorSubject<Bip353Result | null>(
    null
  );
  readonly bip353$: Observable<Bip353Result | null> =
    this.bip353Subject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('Payment Standards & Private-Discovery Studio');
  }

  parseBip21(): void {
    const raw = this.bip21Uri.trim();
    if (!raw.toLowerCase().startsWith('bitcoin:')) {
      this.parsedBip21Subject.next(null);
      this.bip21Notice = 'Enter a bitcoin: payment URI.';
      return;
    }

    const withoutScheme = raw.slice('bitcoin:'.length);
    const separator = withoutScheme.indexOf('?');
    const address =
      separator === -1 ? withoutScheme : withoutScheme.slice(0, separator);
    const queryString =
      separator === -1 ? '' : withoutScheme.slice(separator + 1);
    if (!/^[0-9A-Za-z]{14,120}$/.test(address)) {
      this.parsedBip21Subject.next(null);
      this.bip21Notice =
        'The URI does not contain a recognizable Bitcoin address string.';
      return;
    }
    const params = new URLSearchParams(queryString || '');
    if ([...params.keys()].some((key) => key.startsWith('req-'))) {
      this.parsedBip21Subject.next(null);
      this.bip21Notice =
        'This URI contains a required parameter that this inspector cannot interpret.';
      return;
    }
    const amount = params.get('amount');
    if (amount !== null && !/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(amount)) {
      this.parsedBip21Subject.next(null);
      this.bip21Notice =
        'The amount must be a non-negative BTC decimal with no more than eight places.';
      return;
    }

    this.parsedBip21Subject.next({
      address,
      amountBtc: amount || undefined,
      label: params.get('label') || undefined,
      message: params.get('message') || undefined,
      lightning: params.get('lightning') || undefined,
      pj: params.get('pj') || undefined,
      silentPayment: params.get('sp') || undefined,
    });
    this.bip21Notice =
      'Parsed locally. The address checksum and payment destination were not verified.';
  }

  resolveBip353(): void {
    const name = this.bip353Name.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(name)) {
      this.bip353Subject.next({
        kind: 'invalid-input',
        humanName: name,
        message: 'Enter a name in user@domain form.',
      });
      return;
    }

    this.bip353Subject.next({
      kind: 'unavailable',
      humanName: name,
      message:
        'DNSSEC-backed BIP353 resolution is unavailable in this build. No address was resolved or verified.',
    });
  }
}
