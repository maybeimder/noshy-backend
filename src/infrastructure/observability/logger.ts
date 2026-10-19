import { randomUUID } from 'node:crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  id: string;
  timestamp: string;
  level: LogLevel;
  event: string;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

const sensitiveKey = /password|token|authorization|cookie|secret|api[-_]?key/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    sensitiveKey.test(key) ? '[REDACTED]' : redact(nested)
  ]));
}

export type LogListener = (entry: LogEntry) => void;

export class ApplicationLogger {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<LogListener>();

  constructor(private readonly maxEntries = 2_000) {}

  log(level: LogLevel, event: string, message: string, details?: Record<string, unknown>) {
    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      event,
      message,
      ...(details ? { details: redact(details) as Record<string, unknown> } : {})
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries);

    const output = JSON.stringify(entry);
    if (level === 'error') console.error(output);
    else if (level === 'warn') console.warn(output);
    else console.log(output);

    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Un suscriptor caído no debe tumbar el logger.
      }
    }
    return entry;
  }

  // Suscripción en vivo (SSE). Devuelve la función para darse de baja.
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  debug(event: string, message: string, details?: Record<string, unknown>) { return this.log('debug', event, message, details); }
  info(event: string, message: string, details?: Record<string, unknown>) { return this.log('info', event, message, details); }
  warn(event: string, message: string, details?: Record<string, unknown>) { return this.log('warn', event, message, details); }
  error(event: string, message: string, details?: Record<string, unknown>) { return this.log('error', event, message, details); }

  list(limit = 200) {
    return this.entries.slice(Math.max(0, this.entries.length - limit));
  }

  clear() {
    this.entries.length = 0;
  }
}

export const applicationLogger = new ApplicationLogger();
