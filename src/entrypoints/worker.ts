// config -> conecta DB -> conecta event bus -> registra los handlers de cada modulo
// ej:
/*

const bus = new RabbitMqEventBus(env.RABBIT_URL);
await bus.connect();

registerExamsHandlers(bus);
registerClassesHandlers(bus);
registerAdminHandlers(bus);

*/
