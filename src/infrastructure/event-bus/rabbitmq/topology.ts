import type { Channel } from 'amqplib';

// Nombres de exchanges y colas. Un solo lugar para cambiarlos.
export const Exchanges = {
  // Entrada: routing key = nombre del handler (ej. 'recipes.create'). Topic para poder filtrar por módulo.
  commands: 'noshy.commands',
  // Salida: routing key = eventName (ej. 'recipes.recipe_published'). Topic para suscribirse por patrón.
  events: 'noshy.events',
  // Todo mensaje que se rinde termina aquí (fanout -> una sola cola de revisión).
  deadLetters: 'noshy.dlx'
} as const;

export const Queues = {
  commands: 'noshy.commands.api',
  observers: 'noshy.events.observers',
  deadLetters: 'noshy.dead-letters'
} as const;

// Idempotente: declarar lo que ya existe con los mismos argumentos no hace nada.
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(Exchanges.deadLetters, 'fanout', { durable: true });
  await channel.assertQueue(Queues.deadLetters, { durable: true });
  await channel.bindQueue(Queues.deadLetters, Exchanges.deadLetters, '');

  await channel.assertExchange(Exchanges.commands, 'topic', { durable: true });
  await channel.assertQueue(Queues.commands, { durable: true, deadLetterExchange: Exchanges.deadLetters });
  await channel.bindQueue(Queues.commands, Exchanges.commands, '#');

  await channel.assertExchange(Exchanges.events, 'topic', { durable: true });
  await channel.assertQueue(Queues.observers, { durable: true, deadLetterExchange: Exchanges.deadLetters });
  await channel.bindQueue(Queues.observers, Exchanges.events, '#');
}

export function toBuffer(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value));
}

export function fromBuffer<T>(content: Buffer): T {
  return JSON.parse(content.toString('utf8')) as T;
}
