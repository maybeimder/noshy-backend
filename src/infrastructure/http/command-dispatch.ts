import type { Request, Response } from 'express';
import type { CommandBus } from '../../core/commands/command-bus';

type UserRequest = Request & { user?: { id: string; name: string; email: string } };

export function getCommandBus(request: Request): CommandBus {
  const bus = request.app.get('commandBus') as CommandBus | undefined;
  if (!bus) throw new Error('CommandBus no configurado en la app (ver createServer).');
  return bus;
}

export function routeParam(request: Request, name = 'id'): string {
  const value = request.params[name];
  return Array.isArray(value) ? value[0] : value;
}

// Traduce request -> sobre del CommandBus y los fallos genéricos (400/401) a HTTP.
// Devuelve null si ya respondió; si no, el controller mapea el resultado del servicio como siempre.
export async function runHandler<TResult>(
  request: Request,
  response: Response,
  name: string,
  input: { params?: Record<string, string | undefined>; data?: unknown } = {}
): Promise<{ result: TResult } | null> {
  const outcome = await getCommandBus(request).dispatch({
    name,
    userId: (request as UserRequest).user?.id,
    params: input.params,
    data: input.data
  });

  switch (outcome.status) {
    case 'handled':
      return { result: outcome.result as TResult };
    case 'invalid':
      response.status(400).json({ message: 'Datos inválidos.', issues: outcome.issues });
      return null;
    case 'unauthorized':
      response.status(401).json({ message: 'No autorizado.' });
      return null;
    default:
      throw new Error(`Handler HTTP mal configurado: ${name} (${outcome.status})`);
  }
}
