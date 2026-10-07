import type { DomainEventFactory } from './domain-event.factory';
import type { Outbox } from './event-store';
import type { EventDispatcher } from './subject';

export interface RelayOptions {
  batchSize?: number;
  maxAttempts?: number;
  onError?: (error: unknown, messageId: string) => void;
}

export interface DrainResult {
  dispatched: number;
  failed: number;
}

// Relay del Transactional Outbox: lee los mensajes pendientes en orden, los entrega al
// dispatcher (Subject de cada usuario) y los marca como entregados. Si falla, reintenta
// en el siguiente ciclo; al agotar intentos queda 'dead'. Mientras un evento de un usuario
// falla se bloquean los siguientes de ese mismo usuario para preservar el orden.
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private readonly onError: (error: unknown, messageId: string) => void;
  private running: Promise<DrainResult> | null = null;

  constructor(
    private readonly outbox: Outbox,
    private readonly factory: DomainEventFactory,
    private readonly dispatcher: EventDispatcher,
    options: RelayOptions = {}
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.onError = options.onError ?? ((error, id) => console.error(`[outbox] fallo entregando ${id}`, error));
  }

  // Procesa un lote. Si ya hay uno corriendo, espera ese mismo (sin solapar).
  drain(): Promise<DrainResult> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  // Repite drain() mientras se siga entregando algo (útil en tests y al apagar el proceso).
  async drainAll(): Promise<DrainResult> {
    const total: DrainResult = { dispatched: 0, failed: 0 };
    for (;;) {
      const result = await this.drain();
      total.dispatched += result.dispatched;
      total.failed += result.failed;
      if (result.dispatched === 0) return total;
    }
  }

  start(intervalMs = 250): () => void {
    const timer = setInterval(() => void this.drain(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  private async run(): Promise<DrainResult> {
    const result: DrainResult = { dispatched: 0, failed: 0 };
    const blockedStreams = new Set<string>();

    for (const message of await this.outbox.pending(this.batchSize)) {
      if (blockedStreams.has(message.event.streamId)) continue;
      try {
        await this.dispatcher.dispatch(this.factory.create(message.event));
        await this.outbox.markDispatched(message.id);
        result.dispatched += 1;
      } catch (error) {
        blockedStreams.add(message.event.streamId);
        await this.outbox.markFailed(message.id, error instanceof Error ? error.message : String(error), this.maxAttempts);
        this.onError(error, message.id);
        result.failed += 1;
      }
    }
    return result;
  }
}
