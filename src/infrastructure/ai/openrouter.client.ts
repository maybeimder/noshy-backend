import type { FastifyBaseLogger } from 'fastify';

/** Cliente mínimo de OpenRouter (API compatible con OpenAI). Modo JSON y modelos de respaldo. */
export const DEFAULT_OPENROUTER_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'openrouter/free'];
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class OpenRouterClient {
  constructor(
    private readonly apiKey: string,
    readonly models: string[],
    private readonly log: FastifyBaseLogger,
    private readonly timeoutMs = 30_000,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async chatJson(messages: ChatMessage[], temperature = 0.5): Promise<unknown> {
    const started = performance.now();
    const res = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Noshy' },
      body: JSON.stringify({
        model: this.models[0],
        ...(this.models.length > 1 ? { models: this.models } : {}),
        response_format: { type: 'json_object' },
        temperature,
        messages,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenRouter respondió ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error(`OpenRouter no devolvió contenido${body.error?.message ? `: ${body.error.message}` : ''}`);
    this.log.info({ model: this.models[0], ms: Math.round(performance.now() - started) }, 'openrouter');
    return extractJson(content);
  }
}

/** Extrae el JSON aunque el modelo lo envuelva en ```json … ``` o agregue texto. */
export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}
