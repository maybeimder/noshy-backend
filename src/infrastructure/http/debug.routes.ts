import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { EnvironmentConfig } from '../config/env';
import { applicationLogger, type LogEntry } from '../observability/logger';

function sameSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function debugAccess(environment: EnvironmentConfig, request: Request, response: Response, next: () => void) {
  if (!environment.debugLogsEnabled) {
    response.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Ruta no encontrada.' } });
    return;
  }

  const provided = request.header('x-debug-token') ?? (typeof request.query.token === 'string' ? request.query.token : '');
  if (!environment.debugLogsToken || !sameSecret(provided, environment.debugLogsToken)) {
    response.status(401).json({ error: { code: 'DEBUG_LOGS_UNAUTHORIZED', message: 'Token de logs inválido.' } });
    return;
  }
  next();
}

function limitFrom(request: Request, fallback = 200): number {
  const raw = typeof request.query.limit === 'string' ? Number(request.query.limit) : fallback;
  return Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 2_000) : fallback;
}

export function createDebugRouter(environment: EnvironmentConfig) {
  const router = Router();
  router.use((request, response, next) => debugAccess(environment, request, response, next));

  router.get('/logs', (request, response) => {
    const limit = limitFrom(request);
    const logs = applicationLogger.list(limit);
    response.json({ logs, count: logs.length });
  });

  router.delete('/logs', (_request, response) => {
    applicationLogger.clear();
    applicationLogger.info('debug.logs.cleared', 'El buffer de logs fue limpiado.');
    response.status(204).send();
  });

  // Stream en vivo (SSE): manda el buffer actual y luego cada log nuevo en tiempo real.
  router.get('/logs/stream', (request, response) => {
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();

    const send = (entry: LogEntry) => {
      response.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    };

    for (const entry of applicationLogger.list(limitFrom(request, 100))) send(entry);
    const unsubscribe = applicationLogger.subscribe(send);
    const heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000);

    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // Visor en el navegador: consume /logs y /logs/stream con filtros en vivo.
  router.get('/logs/view', (request, response) => {
    const token = typeof request.query.token === 'string' ? request.query.token : '';
    response.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Noshy logs</title>
<style>
  body{font:13px/1.45 monospace;background:#111;color:#ddd;margin:0;padding:16px}
  h1{font-size:16px;margin:0 0 12px}
  .toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
  input,select,button{font:inherit;background:#1e1e1e;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px}
  button{cursor:pointer}button:hover{background:#2a2a2a}
  #status{color:#888}
  table{border-collapse:collapse;width:100%}
  td,th{border:1px solid #333;padding:6px 8px;vertical-align:top;text-align:left}
  th{background:#1a1a1a;position:sticky;top:0}
  .debug{color:#7aa2f7}.info{color:#c0caf5}.warn{background:#332b00;color:#e0af68}.error{background:#3b1111;color:#f7768e}
  pre{white-space:pre-wrap;margin:0;color:#999;max-width:420px}
  .ts{white-space:nowrap;color:#888}.evt{color:#9ece6a}
  tr{cursor:pointer}tr:hover{outline:1px solid #555}
</style></head><body>
<h1>Noshy logs en vivo <span id="count"></span> <span id="status"></span></h1>
<div class="toolbar">
  <input id="search" type="search" placeholder="filtrar por texto, path, comando..." size="36">
  <select id="level"><option value="">todos los niveles</option><option>debug</option><option>info</option><option>warn</option><option>error</option></select>
  <button id="pause">pausar</button>
  <button id="clear">limpiar</button>
  <label><input type="checkbox" id="autoscroll" checked> seguir el final</label>
</div>
<table><thead><tr><th>Fecha</th><th>Nivel</th><th>Evento</th><th>Mensaje</th><th>Detalles</th></tr></thead><tbody id="rows"></tbody></table>
<script>
  const TOKEN = ${JSON.stringify(token)};
  const params = new URLSearchParams(location.search);
  params.set('token', TOKEN);
  const qs = params.toString();
  const rows = document.getElementById('rows');
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const searchEl = document.getElementById('search');
  const levelEl = document.getElementById('level');
  const pauseEl = document.getElementById('pause');
  const clearEl = document.getElementById('clear');
  const autoEl = document.getElementById('autoscroll');
  let logs = [], paused = false, hidden = 0;

  const esc = (v) => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const matches = (entry) => {
    if (levelEl.value && entry.level !== levelEl.value) return false;
    const q = searchEl.value.trim().toLowerCase();
    if (!q) return true;
    return JSON.stringify(entry).toLowerCase().includes(q);
  };
  const render = () => {
    const visible = logs.filter(matches);
    hidden = logs.length - visible.length;
    rows.innerHTML = visible.map((e) => '<tr class="' + esc(e.level) + '"><td class="ts">' + esc(e.timestamp) + '</td><td>' + esc(e.level) + '</td><td class="evt">' + esc(e.event) + '</td><td>' + esc(e.message) + '</td><td><pre>' + esc(JSON.stringify(e.details ?? {})) + '</pre></td></tr>').join('');
    countEl.textContent = '(' + logs.length + ' en el servidor, ' + visible.length + ' visibles' + (hidden ? ', ' + hidden + ' ocultos por el filtro' : '') + ')';
    if (autoEl.checked) window.scrollTo(0, document.body.scrollHeight);
  };
  const add = (entry) => {
    logs.push(entry);
    if (logs.length > 2000) logs.shift();
    if (!paused) render();
  };

  fetch('/debug/logs?' + qs).then((r) => r.json()).then((data) => { (data.logs ?? []).forEach(add); statusEl.textContent = 'conectado'; }).catch(() => { statusEl.textContent = 'error cargando logs iniciales'; });
  const source = new EventSource('/debug/logs/stream?' + qs);
  source.addEventListener('log', (event) => add(JSON.parse(event.data)));
  source.onopen = () => { statusEl.textContent = 'en vivo'; };
  source.onerror = () => { statusEl.textContent = 'conexión SSE perdida, reconectando...'; };

  searchEl.addEventListener('input', render);
  levelEl.addEventListener('change', render);
  pauseEl.addEventListener('click', () => { paused = !paused; pauseEl.textContent = paused ? 'reanudar' : 'pausar'; if (!paused) render(); });
  clearEl.addEventListener('click', async () => { await fetch('/debug/logs?' + qs, { method: 'DELETE' }); logs = []; render(); });
</script>
</body></html>`);
  });

  return router;
}
