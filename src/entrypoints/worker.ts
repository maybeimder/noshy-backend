// config -> conecta DB -> conecta event store -> arranca el OutboxRelay (que despacha a los observers)
// Con el store en memoria el relay vive en el mismo proceso que la API (ver api.ts); este proceso
// solo tiene sentido cuando el Event Store/Outbox estén en una base de datos compartida.
import { startEventProcessing } from '../infrastructure/event-bus/register-observers';

startEventProcessing();
console.log('Worker listo: OutboxRelay en marcha.');
