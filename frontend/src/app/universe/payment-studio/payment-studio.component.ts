import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

interface Bip21Parsed {
  readonly address: string;
  readonly amountBtc?: string;
  readonly label?: string;
  readonly message?: string;
  readonly lightning?: string;
  readonly pj?: string;
  readonly silentPayment?: string;
}

interface Bip353Result {
  readonly humanName: string;
  readonly resolvedAddress: string;
  readonly dnssecValid: boolean;
  readonly txtRecord: string;
}

@Component({
  selector: 'app-payment-studio',
  templateUrl: './payment-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentStudioComponent {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  bip21Uri = 'bitcoin:bc1q89abcdefabbaabbaabbaabbaabbaabbaabba?amount=0.005&label=Universe&lightning=lno1pg257enxv4ezqcneype82um50ynhxgrwdajx283q890cdse444n894v69n0q2sxve80q';
  bip353Name = 'user@bitcoinuniverse.io';

  private readonly parsedBip21Subject = new BehaviorSubject<Bip21Parsed | null>(null);
  readonly parsedBip21$: Observable<Bip21Parsed | null> = this.parsedBip21Subject.asObservable();

  private readonly bip353Subject = new BehaviorSubject<Bip353Result | null>(null);
  readonly bip353$: Observable<Bip353Result | null> = this.bip353Subject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('Payment Standards & Private-Discovery Studio');
    this.parseBip21();
  }

  parseBip21(): void {
    const raw = this.bip21Uri.trim();
    if (!raw.startsWith('bitcoin:')) return;

    const withoutScheme = raw.slice('bitcoin:'.length);
    const [address, queryString] = withoutScheme.split('?');
    const params = new URLSearchParams(queryString || '');

    this.parsedBip21Subject.next({
      address: address || '',
      amountBtc: params.get('amount') || undefined,
      label: params.get('label') || undefined,
      message: params.get('message') || undefined,
      lightning: params.get('lightning') || undefined,
      pj: params.get('pj') || undefined,
      silentPayment: params.get('sp') || undefined,
    });
  }

  resolveBip353(): void {
    const name = this.bip353Name.trim();
    if (!name.includes('@')) return;

    this.bip353Subject.next({
      humanName: name,
      resolvedAddress: 'bc1q89abcdefabbaabbaabbaabbaabbaabbaabba',
      dnssecValid: true,
      txtRecord: `bitcoin:bc1q89abcdefabbaabbaabbaabbaabbaabbaabba`,
    });
  }
}
