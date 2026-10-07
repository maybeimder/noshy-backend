// Carga backend/.env (si existe) en process.env. Lo que ya esté definido en la terminal tiene prioridad.
// Solo lo llaman los entrypoints: los tests no leen .env para no depender de la máquina.
export function loadEnvFile(path = '.env'): boolean {
  try {
    process.loadEnvFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
