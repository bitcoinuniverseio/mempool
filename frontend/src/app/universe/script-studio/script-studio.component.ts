import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BehaviorSubject, Observable } from 'rxjs';
import { SeoService } from '@app/services/seo.service';

export interface ScriptResult {
  readonly kind: 'invalid-input' | 'unavailable';
  readonly tokens: readonly string[];
  readonly message: string;
}

@Component({
  selector: 'app-script-studio',
  templateUrl: './script-studio.component.html',
  styleUrls: ['../product-page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScriptStudioComponent {
  scriptInput = '';
  profile: 'standard' | 'covenant-cat' | 'ctv' = 'standard';

  private readonly resultSubject = new BehaviorSubject<ScriptResult | null>(null);
  readonly result$: Observable<ScriptResult | null> = this.resultSubject.asObservable();

  constructor(private seo: SeoService) {
    this.seo.setTitle('Bitcoin Script, Miniscript & Taproot Studio');
  }

  trace(): void {
    const input = this.scriptInput.trim();
    const tokens = input ? input.split(/\s+/) : [];
    this.resultSubject.next({
      kind: tokens.length > 0 ? 'unavailable' : 'invalid-input',
      tokens,
      message: tokens.length > 0
        ? 'Bitcoin Script execution and address derivation are unavailable in this build. The input was tokenized only and was not evaluated.'
        : 'Enter a script before inspecting it.',
    });
  }
}
