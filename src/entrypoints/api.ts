// Estos en entrypoint son los main de cada proceso
// config -> conecta DB -> conecta event bus -> crea un server -> router -> app.listen()
import { getEnv } from '../infrastructure/config/env';
import { createServer } from '../infrastructure/http/server';

const environment = getEnv();

createServer().listen(environment.port, () => {
  console.log(`Server is running on port ${environment.port} at http://localhost:${environment.port}`);
});
