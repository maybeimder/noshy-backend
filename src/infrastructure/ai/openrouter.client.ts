import type { FastifyBaseLogger } from 'fastify';

/**
 * Cliente mínimo de OpenRouter (API compatible con OpenAI) en modo JSON.
 * Los modelos gratuitos se retiran sin aviso: se prueba uno por uno, así uno retirado o saturado no tumba a los demás.
 */
export const DEFAULT_OPENROUTER_MODELS = ['google/gemma-4-31b-it:free', 'inclusionai/ling-3.2-flash:free', 'openrouter/free'];
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** La cuenta no puede usar la API (key mala, sin saldo, bloqueada): con otro modelo pasaría lo mismo. */
const ACCOUNT_ERRORS = new Set([401, 402, 403]);

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

class AccountError extends Error {}

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string,
    readonly models: string[],
    private readonly log: FastifyBaseLogger,
    /** Por modelo. */
    private readonly timeoutMs = 15_000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async chatJson(messages: ChatMessage[], temperature = 0.5): Promise<unknown> {
    let last: unknown = new Error('OpenRouter sin modelos configurados');
    for (const model of this.models) {
      const started = performance.now();
      try {
        const out = await this.ask(model, messages, temperature);
        this.log.info({ model, ms: Math.round(performance.now() - started) }, 'openrouter');
        return out;
      } catch (err) {
        last = err;
        if (err instanceof AccountError) break;
        this.log.warn({ model, ms: Math.round(performance.now() - started), reason: err instanceof Error ? err.message : String(err) }, 'openrouter: el modelo falló');
      }
    }
    throw last;
  }

  private async ask(model: string, messages: ChatMessage[], temperature: number): Promise<unknown> {
    const res = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Noshy' },
      body: JSON.stringify({ model, response_format: { type: 'json_object' }, temperature, messages }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const message = `OpenRouter respondió ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`;
      throw ACCOUNT_ERRORS.has(res.status) ? new AccountError(message) : new Error(message);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(`OpenRouter no devolvió contenido${body.error?.message ? `: ${body.error.message}` : ''}`);
    return extractJson(content);
  }
}

/** Extrae el JSON aunque el modelo lo envuelva en ```json … ``` o agregue texto. */
export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}
