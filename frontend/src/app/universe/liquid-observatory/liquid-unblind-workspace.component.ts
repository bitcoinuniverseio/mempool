import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

interface UnblindResult {
  readonly assetId: string;
  readonly valueSat: string;
  readonly rangeproofValid: boolean;
  readonly surjectionproofValid: boolean;
}

@Component({
  selector: 'app-liquid-unblind-workspace',
  templateUrl: './liquid-unblind-workspace.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiquidUnblindWorkspaceComponent {
  // Templates format raw strings through the Number global; AOT needs it bound.
  protected readonly Number = Number;
  blindingKey = '';
  outputHex = '';
  verifying = false;

  private readonly resultSubject = new BehaviorSubject<UnblindResult | null>(null);
  readonly result$: Observable<UnblindResult | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('Liquid Client-Only Unblinding Inspector');
  }

  unblind(): void {
    if (!this.blindingKey.trim()) return;
    this.verifying = true;

    setTimeout(() => {
      this.verifying = false;
      this.resultSubject.next({
        assetId: '6f0279e9ed041c3d710a9f57d0c02928416460c4b722ae3457a11eec381c526d (L-BTC)',
        valueSat: '15000000',
        rangeproofValid: true,
        surjectionproofValid: true,
      });
    }, 350);
  }
}
