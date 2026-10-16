// Autosave con debounce verso il repository (regola di convivenza 3):
// il repository riceve poco spesso (3–5 s), ma flushNow() salva SUBITO su
// pausa/background/chiusura. Le due regole convivono: qui il debounce, in
// DictationSession il testo che non vive mai solo in RAM.

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export interface DebouncedSaverOptions {
  save: (text: string) => Promise<void>;
  /** Debounce verso il repository; range tipico 3–5 s. */
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

  /** Nuovo testo da salvare: riparte il timer di debounce. */
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
   * Salvataggio immediato, saltando il debounce (pausa/background/chiusura).
   * Senza argomento salva l'ultimo testo schedulato, se c'è qualcosa in sospeso.
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

  /** Ferma i timer. Non salva: chi chiude deve prima chiamare flushNow(). */
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
    // un salvataggio è già in corsa: al suo ritorno ripartirà da solo se dirty
    if (this.saving || !this.dirty || this.latestText === undefined) return;
    this.saving = true;
    this.dirty = false;
    const text = this.latestText;
    this.options.onStatus?.('saving');
    try {
      await this.options.save(text);
      if (!this.dirty) this.options.onStatus?.('saved');
    } catch {
      // testo conservato: si ritenta al prossimo giro di debounce
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
      // arrivato altro testo (o un flush) mentre si salvava: si riparte subito
      if (this.dirty && this.timer === undefined && !this.disposed) void this.run();
    }
  }
}
