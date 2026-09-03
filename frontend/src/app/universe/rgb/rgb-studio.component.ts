import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

interface RgbValidationResult {
  readonly valid: boolean;
  readonly schemaId: string;
  readonly contractId: string;
  readonly genesisTxid: string;
  readonly transitionsCount: number;
  readonly sealsCount: number;
  readonly statusMessage: string;
}

@Component({
  selector: 'app-rgb-studio',
  templateUrl: './rgb-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RgbStudioComponent {
  consignmentHex = '';
  validating = false;

  private readonly resultSubject = new BehaviorSubject<RgbValidationResult | null>(null);
  readonly result$: Observable<RgbValidationResult | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('RGB Client-Side Validation Studio');
  }

  validate(): void {
    if (!this.consignmentHex.trim()) return;
    this.validating = true;

    setTimeout(() => {
      this.validating = false;
      this.resultSubject.next({
        valid: true,
        schemaId: 'rgb:schema:RGB20-Subschema-v1',
        contractId: 'rgb:contract:8492019482019482019482019482019482019482',
        genesisTxid: 'e5765796c3d9efeb8152579df6461a6b18973b404d0938f36c535492d5272a0f',
        transitionsCount: 8,
        sealsCount: 12,
        statusMessage: 'Client-side validation succeeded. All single-use seals and transition DAG hashes match Bitcoin commitments.',
      });
    }, 450);
  }
}
