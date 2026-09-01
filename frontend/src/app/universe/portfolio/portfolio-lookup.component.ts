import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { SeoService } from '@app/services/seo.service';

interface ChainInterpretation {
  readonly chain: string;
  readonly network: string;
  readonly label: string;
}

const BASE58_DOGE = /^[DA9][1-9A-HJ-NP-Za-km-z]{20,60}$/;
const BASE58_BITCOIN = /^[13][1-9A-HJ-NP-Za-km-z]{20,60}$/;
const BECH32_BITCOIN = /^(bc1)[0-9a-z]{6,90}$/i;
const ZCASH_TRANSPARENT = /^t[0-9A-Za-z]{10,60}$/;
const ZCASH_SHIELDED = /^(zs|u1)[0-9a-z]{10,256}$/i;
const GENERIC = /^[0-9A-Za-z]{14,120}$/;

/**
 * Which chains an address string can be read on. A Taproot-style string is
 * valid on both Bitcoin and Fractal, and the two are different ledgers with
 * different holdings; the reader chooses explicitly, never the code.
 */
export function interpretAddress(input: string): ChainInterpretation[] {
  const address = input.trim();
  if (address.length === 0) { return []; }
  const interpretations: ChainInterpretation[] = [];
  if (BASE58_DOGE.test(address)) {
    interpretations.push({ chain: 'dogecoin', network: 'mainnet', label: 'Dogecoin' });
  }
  if (ZCASH_TRANSPARENT.test(address) || ZCASH_SHIELDED.test(address)) {
    interpretations.push({ chain: 'zcash', network: 'mainnet', label: 'Zcash' });
  }
  if (BASE58_BITCOIN.test(address) || BECH32_BITCOIN.test(address)) {
    interpretations.push({ chain: 'bitcoin', network: 'mainnet', label: 'Bitcoin' });
    // The same script encodings are valid on Fractal. Separate ledger,
    // separate portfolio; both are offered and neither is assumed.
    interpretations.push({ chain: 'fractal', network: 'mainnet', label: 'Fractal Bitcoin' });
  }
  if (interpretations.length === 0 && GENERIC.test(address)) {
    interpretations.push({ chain: 'bitcoin', network: 'mainnet', label: 'Bitcoin' });
  }
  return interpretations;
}

/**
 * The portfolio entry page: paste an address, pick the chain it should be
 * read on, open the portfolio. When one string is readable on more than one
 * chain, every reading is offered side by side.
 */
@Component({
  selector: 'app-universe-portfolio-lookup',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './portfolio-lookup.component.html',
  styleUrls: ['./portfolio-lookup.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioLookupComponent implements OnInit {
  input = '';
  interpretations: ChainInterpretation[] = [];
  touched = false;

  constructor(
    private router: Router,
    private seo: SeoService,
  ) {}

  ngOnInit(): void {
    this.seo.setTitle($localize`:@@universe.portfolio.lookup-title:Address portfolio`);
  }

  update(value: string): void {
    this.input = value;
    this.touched = true;
    this.interpretations = interpretAddress(value);
  }

  open(interpretation: ChainInterpretation): void {
    const address = this.input.trim();
    if (!address) { return; }
    this.router.navigate([
      '/portfolio', interpretation.chain, interpretation.network, address,
    ]);
  }

  submit(): void {
    // Enter opens the only reading when there is exactly one. With several,
    // the buttons below are the choice; nothing is picked silently.
    if (this.interpretations.length === 1) {
      this.open(this.interpretations[0]);
    }
  }
}
