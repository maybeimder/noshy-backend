import type { Channel } from 'amqplib';

/**
 * Nombres de exchanges y colas. Un broker que ya los tenga declarados con los mismos argumentos se reutiliza.
 *
 *   outbox relay ──publish(routingKey = tipo del evento)──▶ noshy.events (topic)
 *                                                              │ '#'
 *                                                              ▼
 *                                                  noshy.events.observers ──▶ worker → Subject → Observers
 *                                                     ▲            │ falla
 *                         (TTL vencido, vuelve) ──────┘            ├──▶ noshy.events.retry.<n>ms (espera)
 *                                                                  └──▶ agotó intentos → noshy.dlx (fanout) → noshy.dead-letters
 */
export type Topology = {
  exchanges: { events: string; deadLetters: string };
  queues: { observers: string; deadLetters: string; retries: { name: string; delayMs: number }[] };
};

export const DEFAULT_RETRY_DELAYS_MS = [5_000, 30_000, 120_000, 600_000];

export function topology(prefix = 'noshy', retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS): Topology {
  return {
    exchanges: {
      // Routing key = tipo del evento (ej. `pantry.items_added`): se puede suscribir por patrón (`pantry.*`).
      events: `${prefix}.events`,
      // Todo mensaje que se rinde termina aquí (fanout → una sola cola de revisión).
      deadLetters: `${prefix}.dlx`,
    },
    queues: {
      observers: `${prefix}.events.observers`,
      deadLetters: `${prefix}.dead-letters`,
      // El nombre lleva el retardo: cambiar los tiempos crea colas nuevas en vez de chocar con las viejas.
      retries: retryDelaysMs.map((delayMs) => ({ name: `${prefix}.events.retry.${delayMs}ms`, delayMs })),
    },
  };
}

/** Idempotente: declarar lo que ya existe con los mismos argumentos no hace nada. */
export async function assertTopology(channel: Channel, t: Topology): Promise<void> {
  await channel.assertExchange(t.exchanges.deadLetters, 'fanout', { durable: true });
  await channel.assertQueue(t.queues.deadLetters, { durable: true });
  await channel.bindQueue(t.queues.deadLetters, t.exchanges.deadLetters, '');

  await channel.assertExchange(t.exchanges.events, 'topic', { durable: true });
  await channel.assertQueue(t.queues.observers, { durable: true, deadLetterExchange: t.exchanges.deadLetters });
  await channel.bindQueue(t.queues.observers, t.exchanges.events, '#');

  // Colas de espera: sin consumidores. Al vencer el TTL, RabbitMQ devuelve el mensaje a la cola de observers.
  for (const r of t.queues.retries) {
    await channel.assertQueue(r.name, {
      durable: true,
      messageTtl: r.delayMs,
      deadLetterExchange: '',
      deadLetterRoutingKey: t.queues.observers,
    });
  }
}

export const ATTEMPT_HEADER = 'x-noshy-attempt';
export const ERROR_HEADER = 'x-noshy-last-error';
