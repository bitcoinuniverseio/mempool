import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

export function shortenIdentifier(
  value: string,
  visibleCharacters = 22
): string {
  if (!value || value.length <= visibleCharacters) {
    return value;
  }
  const available = Math.max(8, visibleCharacters - 1);
  const leading = Math.ceil(available / 2);
  const trailing = Math.floor(available / 2);
  return `${value.slice(0, leading)}…${value.slice(-trailing)}`;
}

@Component({
  selector: 'app-universe-identifier',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `
    <span class="identifier">
      <a
        *ngIf="link; else plainValue"
        class="value"
        [routerLink]="link"
        [title]="value"
        [attr.aria-label]="label + ': ' + value"
      >
        <span aria-hidden="true">{{ displayed }}</span>
      </a>
      <ng-template #plainValue>
        <span class="value" [title]="value">
          <span aria-hidden="true">{{ displayed }}</span>
          <span class="visually-hidden">{{ value }}</span>
        </span>
      </ng-template>
      <button
        type="button"
        class="copy"
        [disabled]="!value"
        [attr.aria-label]="'Copy ' + label"
        [title]="feedback || 'Copy ' + label"
        (click)="copy()"
      >
        Copy
      </button>
      <span class="visually-hidden" role="status" aria-live="polite">{{
        feedback
      }}</span>
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-block;
        max-width: 100%;
        min-width: 0;
        vertical-align: middle;
      }

      .identifier {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        max-width: 100%;
        min-width: 0;
      }

      .value {
        min-width: 0;
        color: inherit;
        font: inherit;
        white-space: nowrap;
      }

      .copy {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 44px;
        min-height: 44px;
        padding: 0.35rem 0.5rem;
        border: 1px solid var(--u-border);
        border-radius: var(--u-radius-sm, 3px);
        background: var(--u-surface-sunken);
        color: var(--u-text-primary);
        font: inherit;
        cursor: pointer;
      }

      .copy:hover {
        background: var(--u-surface-hover);
      }

      .copy:focus-visible {
        outline: 2px solid var(--u-accent);
        outline-offset: 2px;
      }

      .copy:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UniverseIdentifierComponent implements OnDestroy {
  @Input() value = '';
  @Input() label = 'identifier';
  @Input() link: string | readonly unknown[] | null = null;
  @Input() visibleCharacters = 22;

  feedback = '';
  private feedbackTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly cd: ChangeDetectorRef) {}

  get displayed(): string {
    return shortenIdentifier(this.value, this.visibleCharacters);
  }

  async copy(): Promise<void> {
    if (!this.value) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(this.value);
      } else {
        this.copyWithTemporaryField();
      }
      this.showFeedback($localize`:@@universe.identifier-copied:Copied`);
    } catch {
      this.showFeedback(
        $localize`:@@universe.identifier-copy-failed:Copy failed`
      );
    }
  }

  ngOnDestroy(): void {
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
    }
  }

  private copyWithTemporaryField(): void {
    if (
      typeof document === 'undefined' ||
      typeof document.execCommand !== 'function'
    ) {
      throw new Error('clipboard unavailable');
    }
    const previousFocus = document.activeElement as HTMLElement | null;
    const field = document.createElement('textarea');
    field.value = this.value;
    field.readOnly = true;
    field.style.position = 'fixed';
    field.style.inset = '0';
    field.style.width = '1px';
    field.style.height = '1px';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    previousFocus?.focus();
    if (!copied) {
      throw new Error('clipboard unavailable');
    }
  }

  private showFeedback(message: string): void {
    this.feedback = message;
    this.cd.markForCheck();
    if (this.feedbackTimer) {
      clearTimeout(this.feedbackTimer);
    }
    this.feedbackTimer = setTimeout(() => {
      this.feedback = '';
      this.cd.markForCheck();
    }, 1500);
  }
}
