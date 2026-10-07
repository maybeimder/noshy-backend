# Colección de Bruno — Noshy API

34 requests en orden que recorren el flujo MVP completo: registro → plan → inventario → receta → comunidad → lista de compras → chef (IA) → feedback → cierre de sesión → limpieza.

- El **token JWT** y los ids (`recipeId`, `itemId`, `sessionId`) se guardan solos en variables al ejecutar cada request.
- Cada corrida registra un usuario nuevo (`ana.<timestamp>@noshy.com`), así que se puede repetir sin errores.
- Cada request trae un test del status esperado.

## Requisitos (una sola vez)

| Herramienta | Para qué |
| ----------- | -------- |
| [Node.js](https://nodejs.org) 22 o superior + [pnpm](https://pnpm.io/installation) | correr la API |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Postgres y RabbitMQ |
| [Bruno](https://www.usebruno.com/downloads) | ejecutar la colección |
| Cuenta en [OpenRouter](https://openrouter.ai/keys) (opcional, gratis) | que el chef responda con IA |

## Paso a paso

**1. Clonar e instalar**

```powershell
git clone --recurse-submodules https://github.com/maybeimder/noshy.git
cd noshy/backend
git checkout dev
pnpm install
```

**2. Levantar la infraestructura** (con Docker Desktop abierto)

```powershell
pnpm infra:up
```

Postgres queda en `localhost:5433` y RabbitMQ en `localhost:5672` (panel en http://localhost:15672, `guest` / `guest`).

**3. Configurar las variables** — en cada terminal que uses para la API o el worker:

```powershell
$env:DATABASE_URL = 'postgres://noshy:noshy@localhost:5433/noshy'
$env:RABBITMQ_URL = 'amqp://guest:guest@localhost:5672'
$env:JWT_SECRET   = 'cambia-esto-por-un-secreto-de-al-menos-32-caracteres'
$env:OPENROUTER_API_KEY = 'sk-or-...'   # opcional: sin ella el chef responde 503
```

En macOS/Linux usa `export DATABASE_URL=...` en lugar de `$env:`.

**4. Arrancar la API y el worker** (dos terminales, ambas con las variables del paso 3)

```powershell
pnpm dev          # terminal 1: API en http://localhost:3000 (migra la base al arrancar)
pnpm dev:worker   # terminal 2: consume eventos de RabbitMQ y alimenta los observers
```

La API debe imprimir `Postgres conectado`, `RabbitMQ conectado` y `Server is running on port 3000`.

**5. Abrir la colección en Bruno**

1. Bruno → **Open Collection** → selecciona la carpeta `backend/bruno`.
2. Arriba a la derecha, elige el entorno **local**.
3. Click derecho sobre la colección → **Run** → **Run Collection**. Deberías ver 34/34 en verde.

También puedes ejecutar las requests una por una en orden (empieza por `01 Auth/Register`, que guarda el token).

**Desde la terminal** (sin abrir Bruno): `pnpm test:bruno`.

## Ver lo que pasó por dentro

```powershell
docker exec -it noshy-postgres psql -U noshy -d noshy
```

```sql
SELECT type, version, occurred_at FROM event_store ORDER BY global_position DESC LIMIT 20;  -- historial de eventos
SELECT status, count(*) FROM outbox GROUP BY status;                                       -- entregas a RabbitMQ
SELECT email, password_hash FROM users;                                                     -- contraseñas hasheadas
```

En el panel de RabbitMQ (*Queues* → `noshy.events.observers`) verás pasar los eventos.

## Problemas comunes

| Síntoma | Causa |
| ------- | ----- |
| `Ask the chef (AI)` devuelve **503** | La API corre sin `OPENROUTER_API_KEY`. El test lo acepta; para que el chef responda, define la key y reinicia la API. |
| `Ask the chef (AI)` devuelve **503** con la key puesta | OpenRouter limitó el uso gratuito (por minuto o por día) o el modelo no respondió. Reintenta luego o cambia `OPENROUTER_MODEL`. |
| Todo devuelve **401** tras reiniciar la API | Sin `JWT_SECRET` fijo, cada arranque usa un secreto nuevo. Define `JWT_SECRET` o vuelve a correr `01 Auth/Register`. |
| La API no conecta a Postgres | Revisa que `docker ps` muestre `noshy-postgres` y que uses el puerto **5433** (el 5432 suele estar ocupado por un Postgres local). |
| Los datos desaparecen al reiniciar | La API corre sin `DATABASE_URL` (modo en memoria). |

## Apagar todo

`Ctrl+C` en las terminales de la API y el worker, y luego `pnpm infra:down` (los datos de Postgres se conservan en un volumen de Docker).
