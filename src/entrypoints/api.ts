// Estos en entrypoint son los main de cada proceso
// config -> conecta DB -> conecta event store -> arranca el OutboxRelay -> crea un server -> router -> app.listen()
import { getEnv } from '../infrastructure/config/env';
import { startEventProcessing } from '../infrastructure/event-bus/register-observers';
import { createServer } from '../infrastructure/http/server';

const environment = getEnv();
// Store en memoria: el relay debe correr en este mismo proceso para entregar a los observers.
startEventProcessing();

createServer().listen(environment.port, () => {
  console.log(`Server is running on port ${environment.port} at http://localhost:${environment.port}`);
});
