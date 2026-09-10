import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';
import { RelativeUrlPipe } from '@app/shared/pipes/relative-url/relative-url.pipe';

/**
 * The outcome of one validation attempt.
 *
 * There is only an unavailable outcome here, because there is no validation
 * engine on this deployment. The revision this replaces waited 450 ms and then
 * emitted a valid result for any input at all, with an invented schema id,
 * contract id, genesis txid, transition count and seal count, and the sentence
 * "All single-use seals and transition DAG hashes match Bitcoin commitments."
 * Nothing read the consignment. A reader could not tell that from a real
 * validation, and on a validator that is the whole of what it offers.
 */
interface RgbValidationOutcome {
  readonly available: false;
  readonly reason: string;
}

@Component({
  selector: 'app-rgb-studio',
  templateUrl: './rgb-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [RelativeUrlPipe, CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RgbStudioComponent {
  consignmentHex = '';

  private readonly resultSubject = new BehaviorSubject<RgbValidationOutcome | null>(null);
  readonly result$: Observable<RgbValidationOutcome | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('RGB Client-Side Validation Studio');
  }

  validate(): void {
    if (!this.consignmentHex.trim()) return;
    this.resultSubject.next({
      available: false,
      reason: $localize`:@@rgb.validator.unavailable:This deployment carries no RGB validation engine, so this consignment has not been checked. Nothing was uploaded.`,
    });
  }
}
