import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { LoadFailure, LoadState, loadFailureMessage } from '@app/shared/load-state';

/**
 * The panel a module shows when it has no fresh data to show.
 *
 * Every non-data outcome lands here, so a failed module says which outcome it
 * is and offers a way forward, rather than leaving a spinner or a skeleton that
 * cannot be told apart from a frozen page.
 */
@Component({
  selector: 'app-load-status',
  templateUrl: './load-status.component.html',
  styleUrls: ['./load-status.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class LoadStatusComponent {
  /** The state to describe. Nothing is rendered for a plain data state. */
  @Input() state: LoadState<unknown> | null = null;
  /** Names the module in the message, for example "Hashrate". */
  @Input() label = '';
  /** Height reserved while loading, so the panel does not shift the layout. */
  @Input() minHeight = '';
  @Output() retry = new EventEmitter<void>();

  get isLoading(): boolean {
    return this.state?.status === 'loading';
  }

  get isEmpty(): boolean {
    return this.state?.status === 'empty';
  }

  get isStale(): boolean {
    return this.state?.status === 'stale';
  }

  get isError(): boolean {
    return this.state?.status === 'error';
  }

  get reason(): LoadFailure | null {
    const state = this.state;
    return state && (state.status === 'error' || state.status === 'stale') ? state.reason : null;
  }

  get message(): string {
    const reason = this.reason;
    return reason ? loadFailureMessage(reason) : '';
  }

  /** A route this deployment does not serve will not start serving it on retry. */
  get canRetry(): boolean {
    const reason = this.reason;
    return reason !== null && reason !== 'missing';
  }

  get observedAt(): number | null {
    const state = this.state;
    return state && state.status === 'stale' ? state.at : null;
  }

  onRetry(): void {
    this.retry.emit();
  }
}
