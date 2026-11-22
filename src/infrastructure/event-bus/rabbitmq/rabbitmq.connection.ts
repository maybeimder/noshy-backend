import { connect, type Channel, type ChannelModel, type ConfirmChannel, type RecoveringChannelModel } from 'amqplib';
import type { FastifyBaseLogger } from 'fastify';
import { assertTopology, type Topology } from './topology.js';

type Channels = { consume: Channel; publish: ConfirmChannel };
type ReadyListener = (channels: Channels) => Promise<void>;

/**
 * Una conexión con reconexión automática y dos canales:
 *  - `consume`: para consumir (el prefetch limita cuántos mensajes sin ack recibe a la vez).
 *  - `publish`: con publisher confirms (el broker confirma que guardó el mensaje).
 *
 * Tras cada (re)conexión se vuelven a crear los canales, se declara la topología y se avisa a los
 * listeners (el consumer vuelve a suscribirse). Mientras no hay conexión, publicar falla y el outbox
 * deja el evento pendiente: nada se pierde.
 */
export class RabbitMqConnection {
  private channels: Channels | null = null;
  private readonly listeners: ReadyListener[] = [];
  private closing = false;

  private constructor(
    private readonly model: RecoveringChannelModel,
    private readonly log: FastifyBaseLogger,
  ) {}

  static async connect(
    url: string,
    opts: { topology: Topology; prefetch: number; log: FastifyBaseLogger; initialRetries?: number },
  ): Promise<RabbitMqConnection> {
    let self: RabbitMqConnection | null = null;
    const pendingSetup: ChannelModel[] = [];
    const model = await connect(url, {
      recovery: {
        initialDelay: 500,
        maxDelay: 15_000,
        initialMaxRetries: opts.initialRetries ?? 20,
        maxRetries: Infinity,
        waitForConnect: false,
        setup: async (m: ChannelModel) => {
          if (self) await self.setup(m, opts.topology, opts.prefetch);
          else pendingSetup.push(m);
        },
      },
    });
    self = new RabbitMqConnection(model, opts.log);
    const conn = self;
    model.on('error', (err) => opts.log.error({ err }, 'rabbitmq: error de conexión'));
    model.on('disconnect', (err) => {
      conn.channels = null;
      if (!conn.closing) opts.log.warn({ err }, 'rabbitmq: desconectado, reintentando');
    });
    model.on('reconnect-scheduled', ({ attempt, delay }) => opts.log.info({ attempt, delay }, 'rabbitmq: reconexión programada'));
    model.on('connect-failed', (err) => opts.log.warn({ err: err.message }, 'rabbitmq: intento de conexión falló'));
    await model.waitForConnect();
    // La primera conexión pudo terminar antes de que existiera `self`.
    for (const m of pendingSetup.splice(0)) await conn.setup(m, opts.topology, opts.prefetch);
    opts.log.info({ prefetch: opts.prefetch }, 'rabbitmq: conectado');
    return conn;
  }

  private async setup(m: ChannelModel, t: Topology, prefetch: number) {
    const consume = await m.createChannel();
    const publish = await m.createConfirmChannel();
    for (const ch of [consume, publish]) {
      ch.on('error', (err) => this.log.error({ err }, 'rabbitmq: error de canal'));
      ch.on('handler-error', (err) => this.log.error({ err }, 'rabbitmq: error en handler'));
    }
    await consume.prefetch(prefetch);
    await assertTopology(consume, t);
    this.channels = { consume, publish };
    for (const l of this.listeners) await l(this.channels);
  }

  /** Se llama ahora (si hay conexión) y después de cada reconexión. */
  async onReady(listener: ReadyListener) {
    this.listeners.push(listener);
    if (this.channels) await listener(this.channels);
  }

  get current(): Channels | null {
    return this.channels;
  }

  get connected(): boolean {
    return this.channels !== null;
  }

  async close() {
    this.closing = true;
    this.channels = null;
    await this.model.close().catch(() => undefined);
  }
}
