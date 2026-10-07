// Único punto de entrada a los servicios. HTTP (controllers) y RabbitMQ (consumers) construyen el mismo
// sobre { name, userId, params, data } y despachan aquí: mismo DTO, misma función de servicio.

// Compatible con zod: cualquier objeto con safeParse sirve (el core no depende de zod).
export interface DataSchema<TData> {
  safeParse(data: unknown):
    | { success: true; data: TData }
    | { success: false; error: { issues: readonly ValidationIssue[] } };
}

// En runtime viajan los issues completos de zod (mismo cuerpo que el 400 de antes).
export interface ValidationIssue {
  message: string;
  code?: string;
  path?: readonly PropertyKey[];
}

export interface HandlerContext<TData> {
  userId: string;
  params: Record<string, string | undefined>;
  data: TData;
}

export interface HandlerDefinition<TData = any, TResult = unknown> {
  readonly name: string;
  // DTO del cuerpo. Sin schema el handler no recibe data.
  readonly schema?: DataSchema<TData>;
  // Parámetros obligatorios (en HTTP vienen de la URL, ej. :id).
  readonly params?: readonly string[];
  // false para operaciones públicas (registro, login, comunidad).
  readonly requiresUser?: boolean;
  readonly execute: (context: HandlerContext<TData>) => TResult | Promise<TResult>;
}

export function defineHandler<TData = undefined, TResult = unknown>(
  definition: HandlerDefinition<TData, TResult>
): HandlerDefinition<TData, TResult> {
  return definition;
}

export interface InboundMessage {
  name: string;
  userId?: string;
  params?: Record<string, string | undefined>;
  data?: unknown;
  // Id del mensaje en el transporte (RabbitMQ). Con él se descartan reentregas.
  messageId?: string;
}

export type HandlerOutcome =
  | { status: 'handled'; result: unknown }
  | { status: 'invalid'; issues: ValidationIssue[] }
  | { status: 'unauthorized' }
  | { status: 'unknown_handler' }
  | { status: 'duplicate' };

export class CommandBus {
  private readonly definitions = new Map<string, HandlerDefinition>();
  private readonly handledMessageIds = new Set<string>();

  register(...definitions: HandlerDefinition[]): this {
    for (const definition of definitions) {
      if (this.definitions.has(definition.name)) {
        throw new Error(`Handler duplicado: ${definition.name}`);
      }
      this.definitions.set(definition.name, definition);
    }
    return this;
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }

  names(): string[] {
    return [...this.definitions.keys()];
  }

  async dispatch(message: InboundMessage): Promise<HandlerOutcome> {
    const definition = this.definitions.get(message.name);
    if (!definition) return { status: 'unknown_handler' };

    if (message.messageId && this.handledMessageIds.has(message.messageId)) {
      return { status: 'duplicate' };
    }

    // Mismo orden que los controllers: primero el cuerpo (400), luego la identidad (401).
    let data: unknown = undefined;
    if (definition.schema) {
      const parsed = definition.schema.safeParse(message.data);
      if (!parsed.success) return { status: 'invalid', issues: [...parsed.error.issues] };
      data = parsed.data;
    }

    const userId = message.userId?.trim() ?? '';
    if (definition.requiresUser !== false && !userId) return { status: 'unauthorized' };

    const params = message.params ?? {};
    const missing = (definition.params ?? []).filter((name) => !params[name]?.trim());
    if (missing.length > 0) {
      return {
        status: 'invalid',
        issues: missing.map((name) => ({ code: 'missing_param', path: [name], message: `Falta el parámetro ${name}.` }))
      };
    }

    const result = await definition.execute({ userId, params, data });
    // Se marca solo si ejecutó sin lanzar: si falla, el transporte puede reintentar el mismo mensaje.
    if (message.messageId) this.handledMessageIds.add(message.messageId);
    return { status: 'handled', result };
  }
}
