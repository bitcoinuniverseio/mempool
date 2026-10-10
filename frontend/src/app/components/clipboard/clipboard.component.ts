import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';

@Component({
  selector: 'app-clipboard',
  templateUrl: './clipboard.component.html',
  styleUrls: ['./clipboard.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClipboardComponent implements OnChanges, OnDestroy {
  @Input() button = false;
  @Input() class = 'btn btn-secondary ml-1';
  @Input() size: 'small' | 'normal' | 'large' = 'normal';
  @Input() text: string;
  @Input() ariaLabel = $localize`:@@clipboard.copy-label:Copy to clipboard`;
  @Input() leftPadding = true;
  copiedMessage: string = $localize`:@@clipboard.copied-message:Copied!`;
  showMessage = false;
  copying = false;
  copyError: string | null = null;
  private destroyed = false;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  widths = {
    small: '10',
    normal: '13',
    large: '18',
  };

  constructor(
    private cd: ChangeDetectorRef,
  ) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.text) {
      this.clearMessageTimer(); this.showMessage = false; this.copyError = null;
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true; this.clearMessageTimer();
  }

  private clearMessageTimer(): void {
    if (this.messageTimer !== null) {clearTimeout(this.messageTimer);}
    this.messageTimer = null;
  }

  async copyText(): Promise<void> {
    if (this.destroyed || this.copying || this.showMessage || this.text === '' || this.text === null || this.text === undefined) {return;}
    const text = String(this.text);
    this.copying = true; this.copyError = null; this.clearMessageTimer();
    try {
      await this.copyToClipboard(text);
      if (this.destroyed || String(this.text) !== text) {return;}
      this.showMessage = true;
      this.messageTimer = setTimeout(() => {
        this.messageTimer = null; this.showMessage = false; this.cd.markForCheck();
      }, 1000);
    } catch {
      if (!this.destroyed && String(this.text) === text) {
        this.showMessage = false;
        this.copyError = $localize`:@@clipboard.failed-message:Could not copy. Select the text to copy.`;
      }
    } finally {
      this.copying = false;
      if (!this.destroyed) {this.cd.markForCheck();}
    }
  }

  async copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      // Use the 'out of viewport hidden text area' trick on non-secure contexts
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.opacity = '0';
      textarea.setAttribute('readonly', 'true'); // Don't trigger keyboard on mobile
      document.body.appendChild(textarea);
      try {
        textarea.select();
        if (!document.execCommand('copy')) {throw new Error('Clipboard copy was not accepted');}
      } finally {
        textarea.remove();
      }
    }
  }

}
