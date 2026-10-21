// Debounced autosave to the repository: the repository is written
// infrequently (3-5 s), but flushNow() saves IMMEDIATELY on
// pause/background/close. The two rules coexist: debounce here, and in
// DictationSession the guarantee that text never lives only in RAM.

/**
 * 'idle' = nothing to save yet (never «Salvato» before a real save);
 * 'saved-local' = safe on the phone, the cloud will catch up.
 */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'saved-local' | 'error';

export interface DebouncedSaverOptions {
  /** Resolves once stored; 'local-only' = stored on the phone only. */
  save: (text: string) => Promise<unknown>;
  /** Debounce toward the repository; typical range 3-5 s. */
  delayMs?: number;
  onStatus?: (status: SaveStatus) => void;
}

export class DebouncedSaver {
  private readonly options: DebouncedSaverOptions;
  private readonly delayMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private latestText?: string;
  private dirty = false;
  private saving = false;
  private disposed = false;

  constructor(options: DebouncedSaverOptions) {
    this.options = options;
    this.delayMs = options.delayMs ?? 3000;
  }

  /** New text to save: restarts the debounce timer. */
  schedule(text: string): void {
    if (this.disposed) return;
    this.latestText = text;
    this.dirty = true;
    this.options.onStatus?.('pending');
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, this.delayMs);
  }

  /**
   * Immediate save, skipping the debounce (pause/background/close).
   * Without an argument it saves the last scheduled text, if anything is pending.
   */
  flushNow(text?: string): void {
    if (this.disposed) return;
    if (text !== undefined) {
      this.latestText = text;
      this.dirty = true;
    }
    this.clearTimer();
    void this.run();
  }

  /** Stops the timers. Does not save: whoever closes must call flushNow() first. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async run(): Promise<void> {
    // a save is already in flight: on return it will rerun by itself if dirty
    if (this.saving || !this.dirty || this.latestText === undefined) return;
    this.saving = true;
    this.dirty = false;
    const text = this.latestText;
    this.options.onStatus?.('saving');
    try {
      const outcome = await this.options.save(text);
      if (!this.dirty) this.options.onStatus?.(outcome === 'local-only' ? 'saved-local' : 'saved');
    } catch {
      // text kept: retried on the next debounce round
      this.dirty = true;
      this.options.onStatus?.('error');
      if (!this.disposed && this.timer === undefined) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.run();
        }, this.delayMs);
      }
    } finally {
      this.saving = false;
      // more text (or a flush) arrived while saving: run again right away
      if (this.dirty && this.timer === undefined && !this.disposed) void this.run();
    }
  }
}
