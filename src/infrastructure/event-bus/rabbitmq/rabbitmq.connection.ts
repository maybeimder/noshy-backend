import { connect, type Channel, type ChannelModel, type ConfirmChannel } from 'amqplib';
import { assertTopology } from './topology';

// Una conexión TCP con dos canales:
//  - channel: para consumir (prefetch limita cuántos mensajes sin ack recibe a la vez).
//  - confirmChannel: para publicar con publisher confirms (el broker confirma que guardó el mensaje).
export class RabbitMqConnection {
  private constructor(
    private readonly model: ChannelModel,
    readonly channel: Channel,
    readonly confirmChannel: ConfirmChannel
  ) {}

  static async connect(url: string, options: { prefetch?: number } = {}): Promise<RabbitMqConnection> {
    const model = await connect(url);
    const channel = await model.createChannel();
    const confirmChannel = await model.createConfirmChannel();
    await channel.prefetch(options.prefetch ?? 10);
    await assertTopology(channel);

    model.on('error', (error) => console.error('[rabbitmq] error de conexión', error));
    return new RabbitMqConnection(model, channel, confirmChannel);
  }

  // Canal extra (ej. para un RabbitMqCommandClient con direct reply-to propio).
  createChannel(): Promise<Channel> {
    return this.model.createChannel();
  }

  async close(): Promise<void> {
    await this.model.close();
  }
}
