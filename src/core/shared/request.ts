import type { FastifyReply, FastifyRequest } from 'fastify';

/** Tipos cortos para los controllers. */
export type Req<T extends { Params?: unknown; Querystring?: unknown; Body?: unknown; Headers?: unknown } = {}> = FastifyRequest<{
  Params: T['Params'];
  Querystring: T['Querystring'];
  Body: T['Body'];
  Headers: T['Headers'];
}>;
export type Rep = FastifyReply;
