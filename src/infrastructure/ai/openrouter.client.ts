// Cliente mínimo de OpenRouter (API compatible con OpenAI), compartido por el agente chef y el redactor de recetas.

// Modelos gratuitos (no consumen créditos). El primero es el preferido; OpenRouter pasa al siguiente si falla.
export const DEFAULT_OPENROUTER_MODELS = ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'openrouter/free'];

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface OpenRouterOptions {
  apiKey: string;
  models?: string[];
  timeoutMs?: number;
  // Inyectable para tests.
  fetch?: typeof fetch;
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export class OpenRouterClient {
  readonly models: string[];
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OpenRouterOptions) {
    this.models = options.models?.length ? options.models : DEFAULT_OPENROUTER_MODELS;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchFn = options.fetch ?? fetch;
  }

  // Pide una respuesta en modo JSON y devuelve el texto tal cual (el llamador lo parsea).
  async chatJson(messages: ChatMessage[], temperature: number): Promise<string> {
    const response = await this.fetchFn(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Noshy'
      },
      body: JSON.stringify({
        model: this.models[0],
        ...(this.models.length > 1 ? { models: this.models } : {}),
        response_format: { type: 'json_object' },
        temperature,
        messages
      }),
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenRouter respondió ${response.status}: ${detail.slice(0, 300)}`);
    }

    const body = (await response.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`OpenRouter no devolvió contenido${body.error?.message ? `: ${body.error.message}` : ''}`);
    }
    return content;
  }
}

// Extrae el JSON aunque el modelo lo envuelva en ```json ... ``` o agregue texto.
export function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}
