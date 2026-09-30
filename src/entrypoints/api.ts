// Estos en entrypoint son los main de cada proceso
// config -> conecta DB -> conecta event bus -> crea un server -> router -> app.listen()
import { createServer } from '../infrastructure/http/server';

const port = Number(process.env.PORT) || 3000;

createServer().listen(port, () => {
  console.log(`Server is running on port ${port} at http://localhost:${port}`);
});
