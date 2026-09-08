import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

export interface RgbValidationResult {
  readonly kind: 'invalid-input' | 'unavailable';
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

  private readonly resultSubject = new BehaviorSubject<RgbValidationResult | null>(null);
  readonly result$: Observable<RgbValidationResult | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('RGB Client-Side Validation Studio');
  }

  validate(): void {
    const input = this.consignmentHex.trim();
    if (!input) {
      this.resultSubject.next({
        kind: 'invalid-input',
        statusMessage: 'Enter an RGB consignment before checking it.',
      });
      return;
    }
    const isHex = input.length % 2 === 0 && /^[0-9a-f]+$/i.test(input);
    const isArmored = /^rgb:[0-9a-z:_-]+$/i.test(input);
    this.resultSubject.next({
      kind: isHex || isArmored ? 'unavailable' : 'invalid-input',
      statusMessage: isHex || isArmored
        ? 'RGB protocol verification is unavailable in this build. No seals, transitions, or Bitcoin commitments were validated.'
        : 'The input is not hexadecimal or a recognizable armored RGB string.',
    });
  }
}
