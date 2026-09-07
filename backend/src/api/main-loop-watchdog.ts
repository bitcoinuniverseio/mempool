/**
 * Watches one run of the main update loop from begin to end.
 *
 * The loop's own stall timers live inside $updateBlocks and $updateMempool
 * and only cover those two calls. On 2026-09-07 a run stuck outside them
 * froze the block cache and the mempool snapshot for eleven hours with
 * nothing in the log, because every message the loop writes sits after the
 * await that never returned. This watchdog runs on its own interval, so it
 * reports a stuck run from outside it and, past a longer limit, hands the
 * process back to the service manager for a restart.
 */
export type MainLoopWatchdogVerdict = 'idle' | 'running' | 'stalled' | 'exit';

export interface MainLoopWatchdogOptions {
  /** A run older than this is reported once as stalled. */
  readonly stallAfterMs: number;
  /** A run older than this asks for the process to exit. */
  readonly exitAfterMs: number;
  readonly now?: () => number;
  readonly onStall: (elapsedMs: number) => void;
  readonly onExit: (elapsedMs: number) => void;
}

export class MainLoopWatchdog {
  private startedAt: number | null = null;
  private stallReported = false;
  private exitRequested = false;
  private readonly now: () => number;

  constructor(private readonly options: MainLoopWatchdogOptions) {
    if (!(options.stallAfterMs > 0) || !(options.exitAfterMs > options.stallAfterMs)) {
      throw new Error('main loop watchdog needs 0 < stallAfterMs < exitAfterMs');
    }
    this.now = options.now ?? Date.now;
  }

  /** Marks the start of one run. */
  begin(): void {
    this.startedAt = this.now();
    this.stallReported = false;
  }

  /** Marks the end of the run, however it ended. */
  end(): void {
    this.startedAt = null;
    this.stallReported = false;
  }

  /** Reports on the run in progress, if any. Safe to call on a timer. */
  check(): MainLoopWatchdogVerdict {
    if (this.startedAt === null) {
      return 'idle';
    }
    const elapsed = this.now() - this.startedAt;
    if (elapsed >= this.options.exitAfterMs) {
      if (!this.exitRequested) {
        this.exitRequested = true;
        this.options.onExit(elapsed);
      }
      return 'exit';
    }
    if (elapsed >= this.options.stallAfterMs) {
      if (!this.stallReported) {
        this.stallReported = true;
        this.options.onStall(elapsed);
      }
      return 'stalled';
    }
    return 'running';
  }
}
