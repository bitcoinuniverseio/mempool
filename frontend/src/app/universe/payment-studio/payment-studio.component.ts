import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { Address, NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { SeoService } from '@app/services/seo.service';
import { StateService } from '@app/services/state.service';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Bip353VerifierService } from './bip353-verifier.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

interface Bip21Parsed {
  readonly address: string;
  readonly amountBtc?: string;
  readonly amountSats?: string;
  readonly label?: string;
  readonly message?: string;
  readonly lightning?: string;
  readonly pj?: string;
  readonly silentPayment?: string;
}

/** BIP21/RFC3986 parsing; amounts never pass through floating point. */
export function parseBip21Uri(input: string, network: string): Bip21Parsed {
  const raw = input.trim();
  if (raw.length > 8192 || !/^bitcoin:/i.test(raw) || /[\s#]/.test(raw)) {
    throw new Error('Enter a bitcoin: payment URI with valid URI encoding.');
  }
  const payload = raw.slice(8);
  const separator = payload.indexOf('?');
  const address = separator < 0 ? payload : payload.slice(0, separator);
  const query = separator < 0 ? '' : payload.slice(separator + 1);
  const addressNetwork = network === '' || network === 'mainnet' ? NETWORK
    : ['signet', 'testnet', 'testnet4'].includes(network) ? TEST_NETWORK
      : network === 'regtest' ? { ...TEST_NETWORK, bech32: 'bcrt' } : null;
  if (!addressNetwork) throw new Error('Select a Bitcoin network to inspect this payment URI.');
  try {
    Address(addressNetwork).decode(address);
  } catch {
    throw new Error('The payment address is missing, invalid, or belongs to another network.');
  }

  const params = new Map<string, string>();
  for (const field of query.split('&')) {
    if (!field) continue;
    const equals = field.indexOf('=');
    const keyRaw = equals < 0 ? field : field.slice(0, equals);
    const valueRaw = equals < 0 ? '' : field.slice(equals + 1);
    // BIP21 qchar excludes raw '=' and '&'; '+' is a literal plus, not a space.
    if (!/^(?:[A-Za-z0-9\-._~!$'()*+,;:@/?]|%[0-9A-Fa-f]{2})+$/.test(keyRaw)
      || !/^(?:[A-Za-z0-9\-._~!$'()*+,;:@/?]|%[0-9A-Fa-f]{2})*$/.test(valueRaw)) {
      throw new Error('A payment parameter contains invalid URI encoding.');
    }
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(keyRaw);
      value = decodeURIComponent(valueRaw);
    } catch {
      throw new Error('A payment parameter contains invalid UTF-8 encoding.');
    }
    if (params.has(key)) throw new Error('Duplicate payment parameters are not supported.');
    if (key.startsWith('req-')) throw new Error('This URI requires an unsupported payment parameter.');
    params.set(key, value);
  }

  const amountBtc = params.get('amount');
  let amountSats: string | undefined;
  if (amountBtc !== undefined) {
    if (!/^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/.test(amountBtc)) {
      throw new Error('The amount must be nonnegative decimal BTC with at most eight decimal places.');
    }
    const [whole, fraction = ''] = amountBtc.split('.');
    const sats = BigInt(whole || '0') * 100000000n + BigInt(fraction.padEnd(8, '0'));
    if (sats > 2100000000000000n) throw new Error('The amount exceeds the Bitcoin supply limit.');
    amountSats = sats.toString();
  }
  return {
    address, amountBtc, amountSats,
    label: params.get('label'), message: params.get('message'),
    lightning: params.get('lightning'), pj: params.get('pj'), silentPayment: params.get('sp'),
  };
}

interface Bip353Result {
  readonly humanName: string;
  readonly resolvedAddress: string;
  readonly dnssecValid: boolean;
  readonly txtRecord: string;
  readonly paymentMethods: readonly string[];
}

@Component({
  selector: 'app-payment-studio',
  templateUrl: './payment-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentStudioComponent implements OnDestroy {
  bip21Uri = '';
  bip21Error: string | null = null;
  private readonly networkSubscription: Subscription;
  bip353Name = '';
  bip353Error: string | null = null;
  resolving = false;
  private resolutionAttempt = 0;
  private resolutionSubscription?: Subscription;
  private expiryTimer?: ReturnType<typeof setTimeout>;

  private readonly parsedBip21Subject = new BehaviorSubject<Bip21Parsed | null>(null);
  readonly parsedBip21$: Observable<Bip21Parsed | null> = this.parsedBip21Subject.asObservable();

  private readonly bip353Subject = new BehaviorSubject<Bip353Result | null>(null);
  readonly bip353$: Observable<Bip353Result | null> = this.bip353Subject.asObservable();

  constructor(private seo: SeoService, private state: StateService, private cdr: ChangeDetectorRef,
    private http: HttpClient, private verifier: Bip353VerifierService) {
    this.seo.setTitle('Payment Standards & Private-Discovery Studio');
    this.networkSubscription = this.state.networkChanged$.subscribe(() => {
      this.clearBip21();
      this.clearBip353();
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.networkSubscription.unsubscribe();
    this.clearBip353();
  }

  clearBip21(): void {
    this.parsedBip21Subject.next(null);
    this.bip21Error = null;
  }

  parseBip21(): void {
    this.clearBip21();
    try {
      this.parsedBip21Subject.next(parseBip21Uri(this.bip21Uri, this.state.network));
    } catch (error) {
      this.bip21Error = error instanceof Error ? error.message : 'The payment URI could not be parsed.';
    }
  }

  resolveBip353(): void {
    this.clearBip353();
    const name = this.bip353Name.trim().replace(/^₿/, '').toLowerCase();
    const parts = name.split('@');
    const validLabels = (text: string): boolean => text.split('.').every(label => /^[a-z0-9_-]{1,63}$/.test(label));
    const queryName = `${parts[0]}.user._bitcoin-payment.${parts[1]}.`;
    if (parts.length !== 2 || !validLabels(parts[0]) || !validLabels(parts[1]) || queryName.length > 254) {
      this.bip353Error = 'Enter an ASCII BIP353 user@domain name.';
      return;
    }
    const attempt = this.resolutionAttempt;
    const network = this.state.network;
    const apiNetwork = network === '' ? 'mainnet' : network;
    const prefix = network ? `/${network}` : '';
    this.resolving = true;
    const fail = (message: string): void => {
      if (attempt !== this.resolutionAttempt) return;
      this.bip353Error = message;
      this.resolving = false;
      this.cdr.markForCheck();
    };
    this.resolutionSubscription = this.http.get<{ name: string; proof: string; ttl: number; network: string }>(
      `${prefix}/api/v1/payment-discovery/bip353`, { params: new HttpParams().set('name', name) }
    ).subscribe({
      next: async response => {
        try {
          if (response.name !== queryName || response.network !== apiNetwork || !Number.isSafeInteger(response.ttl) || response.ttl < 0) {
            throw new Error('The resolver response does not match this name and network.');
          }
          const verified = await this.verifier.verify(response.proof, queryName, network);
          if (attempt !== this.resolutionAttempt || this.state.network !== network) return;
          if (!verified.instructions) throw new Error('The authenticated payment instructions could not be inspected.');
          const addresses = verified.instructions.addresses;
          const now = Math.floor(Date.now() / 1000);
          const remaining = Math.min(response.ttl, verified.maxCacheTtl, verified.expires - now,
            verified.instructions.expires === null ? Infinity : verified.instructions.expires - now);
          if (remaining <= 0) throw new Error('The authenticated payment record has expired.');
          this.bip353Subject.next({ humanName: `₿${name}`, resolvedAddress: addresses.join(', '),
            dnssecValid: true, txtRecord: verified.uri, paymentMethods: verified.instructions.methods });
          this.resolving = false;
          this.expiryTimer = setTimeout(() => {
            this.clearBip353();
            this.bip353Error = 'The authenticated payment record has expired. Resolve the name again.';
            this.cdr.markForCheck();
          }, Math.min(remaining * 1000, 2147483647));
          this.cdr.markForCheck();
        } catch (error) { fail(error instanceof Error ? error.message : 'DNSSEC proof verification failed.'); }
      },
      error: () => fail('No authenticated payment record could be resolved. The name may be absent, unsigned, invalid, or the owned resolver unavailable.'),
    });
  }

  clearBip353(): void {
    this.resolutionAttempt++;
    this.resolutionSubscription?.unsubscribe();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.bip353Subject.next(null);
    this.bip353Error = null;
    this.resolving = false;
  }
}
