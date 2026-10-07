# Noshy Backend

API HTTP de Noshy para el MVP web. Está construida con Node.js, TypeScript, Express 5 y Zod.

## Desarrollo

Desde `backend/`:

```bash
pnpm install
pnpm dev
```

Comprobaciones:

```bash
pnpm test
pnpm build
```

Sin variables de entorno todo corre en memoria (útil para tests). Para la arquitectura completa:

```powershell
pnpm infra:up                     # Postgres (puerto 5433) + RabbitMQ (5672, panel en :15672)
$env:DATABASE_URL='postgres://noshy:noshy@localhost:5433/noshy'
$env:RABBITMQ_URL='amqp://guest:guest@localhost:5672'
pnpm dev                          # API: migra al arrancar, HTTP + comandos por RabbitMQ + relay del outbox
pnpm dev:worker                   # Worker: consume eventos y alimenta los observers
```

Con `DATABASE_URL` y `RABBITMQ_URL` definidas, `pnpm test` también corre los tests de integración contra Postgres y RabbitMQ reales (usan schemas y exchanges temporales y los borran al terminar).

## Arquitectura

Orientada a eventos, con Transactional Outbox y Event Sourcing:

- **Entrada única:** los controllers HTTP y el consumer de RabbitMQ despachan al mismo `CommandBus` (`modules/*/events/*.handlers.ts`), que valida con los mismos DTOs y llama a los mismos servicios.
- **Transactional Outbox:** cada mutación guarda su estado, su evento (`event_store`) y su mensaje (`outbox`) en una sola transacción. El `OutboxRelay` entrega el outbox a RabbitMQ (`noshy.events`) o, sin RabbitMQ, a los observers del mismo proceso.
- **Event Sourcing:** las proyecciones (recomendaciones, preferencias, comunidad) se reconstruyen reproduciendo `event_store`.
- **GoF:** Observer (`Subject` por usuario y observers idempotentes) y Factory Method (agentes chef por tipo de dieta).

## Configuración

Variables opcionales:

| Variable          | Valor por defecto | Descripción                                         |
| ----------------- | ----------------- | --------------------------------------------------- |
| `PORT`            | `3000`            | Puerto HTTP entre 1 y 65535                         |
| `CORS_ORIGIN`     | `*`               | Origen permitido por CORS                           |
| `JSON_BODY_LIMIT` | `1mb`             | Límite de cuerpos JSON, por ejemplo `512kb` o `2mb` |
| `DATABASE_URL`    | —                 | Postgres (`postgres://...`). Sin ella, estado en memoria |
| `RABBITMQ_URL`    | —                 | RabbitMQ (`amqp://...`). Sin ella, eventos en proceso |
| `JWT_SECRET`      | aleatorio         | Secreto (≥32 caracteres) para firmar los JWT. **Obligatorio con `NODE_ENV=production`** |
| `JWT_EXPIRES_IN`  | `7d`              | Vigencia del token, por ejemplo `15m`, `12h` o `7d` |
| `OPENROUTER_API_KEY` | —              | Activa el agente chef con OpenRouter. Sin ella, `respond` devuelve 503 |
| `OPENROUTER_MODEL`   | modelos `:free` | Lista separada por comas; el primero es el preferido y el resto respaldo |

La configuración se valida al iniciar mediante `src/infrastructure/config/env.ts`.

## Autenticación

Los endpoints protegidos usan:

```http
Authorization: Bearer <token>
```

`POST /auth/register` y `POST /auth/login` devuelven un **JWT HS256** firmado con `JWT_SECRET` (emisor `noshy`, audiencia `noshy-api`, `sub` = id del usuario). Se rechazan los tokens adulterados, expirados o firmados con otro secreto. Sin `JWT_SECRET` la API usa un secreto temporal y los tokens dejan de valer al reiniciarla.

No hay revocación ni refresh token: un token vale hasta que expira.

## Contratos principales

| Área             | Operaciones                                                                      |
| ---------------- | -------------------------------------------------------------------------------- |
| Auth             | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`                        |
| Plan nutricional | `POST /plans`, `GET /plans`, `GET /plans/active`, `PUT /plans/active`            |
| Inventario       | `POST/GET /inventory/items`, `PATCH/DELETE /inventory/items/:id`                 |
| Recetas propias  | `POST/GET /recipes`, `PATCH/DELETE /recipes/:id`, publicar y retirar publicación |
| Comunidad        | `GET /community/recipes`, `GET /community/recipes/:id`                           |
| Agente chef      | sesiones, contexto, mensajes y `POST /chef/sessions/:id/respond`                 |
| Feedback         | `POST/GET /feedback`, `GET /recommendations`                                     |
| Compras          | `POST /shopping-list` desde recetas guardadas o recetas inline del agente        |

Los errores de rutas desconocidas y JSON inválido usan el formato:

```json
{
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "Ruta no encontrada."
  }
}
```

## Flujo MVP

```text
Plan nutricional + preferencias
	-> sesión del agente chef
	-> receta adaptada al inventario
	-> lista de compras
	-> feedback comportamental
	-> comunidad de recetas públicas
```

## Workflow Git

Cada feature se crea desde el `dev` remoto actualizado, se implementa y valida en su propia rama, se publica en el remoto y finalmente se fusiona a `dev`.

## Agente chef (OpenRouter)

`POST /chef/sessions/:id/respond` usa `OpenRouterChefAgent` (`src/infrastructure/ai/`). Por defecto usa modelos **gratuitos** (`nvidia/nemotron-3-super-120b-a12b:free`, con respaldo en `google/gemma-4-31b-it:free` y `openrouter/free`), así que no consume créditos. El agente recibe el plan, las preferencias, el inventario, la receta y el historial de la sesión, y responde en JSON con un mensaje y los eventos de feedback que detecte (que se registran como `feedback.feedback_recorded`).

Los modelos gratuitos tienen límites de uso por minuto y por día, y sus proveedores pueden registrar los prompts: no envíes datos sensibles reales.

El frontend y Redis están fuera del alcance de este submódulo en la etapa actual.
