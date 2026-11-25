/**
 * Un handler por comando: recibe el payload y devuelve el resultado (o lanza un error de aplicación).
 * El tipo `any` del parámetro es solo la cota: cada handler declara el suyo y `execute` lo exige.
 */
export type CommandHandler = (command: any) => unknown;
export type CommandHandlers = Record<string, CommandHandler>;

export type CommandPayload<H extends CommandHandler> = Parameters<H>[0];
export type CommandResult<H extends CommandHandler> = Awaited<ReturnType<H>>;

/** Tipo del argumento `I` de un método, para declarar payloads sin repetir el de los servicios. */
export type Arg<F extends (...args: any[]) => unknown, I extends number> = Parameters<F>[I];

/** Lo que ve un middleware. Nunca se registra el payload completo: puede traer contraseñas o archivos. */
export type CommandContext = { readonly type: string; readonly payload: unknown; readonly userId: string | null };
export type CommandMiddleware = (ctx: CommandContext, next: () => Promise<unknown>) => Promise<unknown>;

export class UnknownCommandError extends Error {
  constructor(readonly commandType: string) {
    super(`No hay handler para el comando ${commandType}`);
    this.name = 'UnknownCommandError';
  }
}

export class DuplicateCommandError extends Error {
  constructor(readonly commandType: string) {
    super(`El comando ${commandType} ya tiene handler`);
    this.name = 'DuplicateCommandError';
  }
}

/**
 * Bus de comandos: el único camino por el que HTTP cambia el estado.
 *
 * - Un comando tiene exactamente un handler. Un evento puede tener cero o varios observers.
 * - Es síncrono y en proceso: la respuesta HTTP necesita el resultado, así que no pasa por RabbitMQ.
 * - Los middlewares envuelven todos los comandos, en el orden en que se pasan (el primero es el de afuera).
 * - Los errores del handler salen tal cual: el contrato HTTP no cambia.
 */
export class CommandBus<H extends CommandHandlers> {
  private readonly handlers: ReadonlyMap<string, CommandHandler>;

  constructor(
    handlers: H,
    private readonly middlewares: readonly CommandMiddleware[] = [],
  ) {
    this.handlers = new Map(Object.entries(handlers));
  }

  get types(): string[] {
    return [...this.handlers.keys()];
  }

  async execute<T extends keyof H & string>(type: T, payload: CommandPayload<H[T]>): Promise<CommandResult<H[T]>> {
    const handler = this.handlers.get(type);
    if (!handler) throw new UnknownCommandError(type);
    const userId = (payload as { userId?: unknown } | undefined)?.userId;
    const ctx: CommandContext = { type, payload, userId: typeof userId === 'string' ? userId : null };
    const run = this.middlewares.reduceRight<() => Promise<unknown>>(
      (next, middleware) => () => middleware(ctx, next),
      async () => handler(payload),
    );
    return (await run()) as CommandResult<H[T]>;
  }
}

type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never;

/** Junta los handlers de los módulos. Dos handlers para el mismo comando es un error de arranque. */
export function mergeHandlers<T extends CommandHandlers[]>(...groups: T): UnionToIntersection<T[number]> {
  const all: CommandHandlers = {};
  for (const group of groups) {
    for (const [type, handler] of Object.entries(group)) {
      if (type in all) throw new DuplicateCommandError(type);
      all[type] = handler;
    }
  }
  return all as UnionToIntersection<T[number]>;
}
