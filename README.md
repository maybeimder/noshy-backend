# Noshy · Backend

API de Noshy según el **Contrato API v0.3** (secciones 01 · Bienvenida y onboarding y 02 · La experiencia diaria).
Fastify + TypeScript, Postgres (Drizzle) para lo transaccional y Mongo para lo documental. **Event driven**: event store y transactional outbox en Postgres, RabbitMQ como bus y observers (GoF Observer) que reaccionan; las piezas intercambiables se crean con Factories (GoF Factory).

- Base: `/api/v1` · Auth: `Authorization: Bearer <JWT>` (el `userId` sale del claim `sub`)
- Respuestas `{ data, meta? }` · Errores `{ error: { code, message, details? } }`
- Documentación OpenAPI generada desde los esquemas zod: `GET /docs`

## Arranque rápido

```powershell
pnpm install
Copy-Item .env.example .env     # JWT_SECRET (32+ caracteres), MONGO_URL del homelab y, si quieres chef con IA, OPENROUTER_API_KEY
pnpm infra:up                   # Postgres (5433) + RabbitMQ (5672, panel en :15672). Mongo: el del homelab
pnpm dev                        # http://localhost:3000  ·  docs en /docs
```

Con `RUN_WORKERS=true` (el valor de `.env.example`) `pnpm dev` hace todo en un proceso: publica en RabbitMQ, consume y corre los observers. Para separarlo como en producción, pon `RUN_WORKERS=false` y corre `pnpm dev:worker` en otra terminal.

Al arrancar, la API aplica las migraciones (`drizzle/*.sql`) y, si la base está vacía, carga el catálogo: tiendas, platos, ingredientes, productos, precios y recetas. Se desactiva con `MIGRATE_ON_START=false` y `SEED_ON_START=false`. También están `pnpm db:migrate` y `pnpm db:seed`; ojo: `db:seed` reescribe likes y ratings del catálogo.

## Despliegue con Docker (homelab / server)

Igual que antes: todo en contenedores en **modo dev** (`tsx watch`), con `api` como primer servicio para `web-deploy` y todo escuchando en `127.0.0.1`.

```bash
cp .env.example .env    # JWT_SECRET de 32+ caracteres y OPENROUTER_API_KEY
docker compose up -d --build
```

- Servicios: `api` (HTTP, migra, carga el catálogo y publica en RabbitMQ), `worker` (consume `noshy.events.observers` → observers, relay de respaldo y scheduler), `postgres` (host 5433) y `rabbitmq` (host 5672, panel en http://localhost:15672, usuario `noshy`).
- `./src` y `./drizzle` están montados: tras un `git pull`, `tsx watch` recarga solo. Si cambian dependencias o el Dockerfile, el workflow `deploy-dev` reconstruye la imagen.
- Archivos (facturas, fotos, exportaciones) viven en el volumen `noshy-storage`; Postgres en `noshy-postgres-data`; RabbitMQ en `noshy-rabbitmq-data`.
- **Mongo no va en el compose**: se usa el del homelab (`MONGO_URL` en `.env`, ej. `mongodb://…@192.168.1.10:27017/food?authSource=food`). El backend usa la base de la URL (`food`) salvo que definas `MONGO_DB`; sus colecciones (`chef_threads`, `chef_messages`, `cooking_events`, `user_signals`, `insights`, `receipt_scans`) no chocan con las del catálogo (`products_slim`, `recipes_raw`). Desde los contenedores, `192.168.1.10` se alcanza por la red local, así que Mongo debe escuchar en esa IP y no solo en `127.0.0.1`.
- Respaldo: `docker exec noshy-postgres pg_dump -U noshy noshy > backup.sql` (Mongo se respalda donde vive, en el homelab).

| Script | Qué hace |
| --- | --- |
| `pnpm dev` | API con recarga en caliente. Si `RUN_WORKERS=true`, también consume eventos y corre el scheduler. |
| `pnpm dev:worker` / `pnpm worker` | Solo workers (consumer de RabbitMQ + relay + scheduler), sin HTTP. Para escalar por separado. |
| `pnpm events:replay -- --observer learning --reset` | Reconstruye una proyección desde el event store (`--stream <userId>` para un solo usuario). |
| `pnpm rabbit:up` / `pnpm rabbit:down` | Solo RabbitMQ. |
| `pnpm build` / `pnpm start` | Compila a `dist/` y arranca. |
| `pnpm db:generate` | Genera una migración nueva a partir de los `*.model.ts` de los módulos. |
| `pnpm test` | Unitarias, integración de eventos y e2e del recorrido completo (necesita Postgres y Mongo; ver abajo). |
| `pnpm test:rabbit` | La misma suite, con los eventos pasando por un RabbitMQ real. |
| `pnpm typecheck` | `tsc --noEmit`. |

### Tests

`test/e2e/journey.test.ts` recorre la app de punta a punta como Diana: registro → onboarding → Tu despensa → Inicio → chef (JSON y SSE) → receta adaptada → lista de compras → modo cocina → factura → comunidad → crear receta → perfil. Verifica el contrato y los efectos que llegan por eventos.

`test/integration/events.test.ts` prueba la infraestructura de eventos: Factory, versiones por stream, rollback, concurrencia, append-only, relay (orden, bloqueo por usuario, `dead`), Subject/Observer (idempotencia y orden) y replay. Si hay un RabbitMQ en `TEST_RABBITMQ_URL` (por defecto `amqp://guest:guest@localhost:5672`), también: entrega de punta a punta, reintentos por las colas de espera, dead letters y broker caído.

Usa `TEST_DATABASE_URL` (por defecto `postgres://postgres@localhost:5432/noshy_test`) y `TEST_MONGO_URL` + `TEST_MONGO_DB` (por defecto `mongodb://127.0.0.1:27017` y `noshy_test`). En cada corrida se recrea la base de Postgres y se vacían **solo** las colecciones del backend en la base de Mongo de prueba; si `TEST_MONGO_DB` no lleva «test» en el nombre, los tests se niegan a correr (así nunca tocan `food`). Contra el Mongo del homelab: un usuario con `readWrite` sobre `noshy_test` y `TEST_MONGO_URL=mongodb://usuario:clave@192.168.1.10:27017/?authSource=…`. Con el compose: `TEST_DATABASE_URL=postgres://noshy:noshy@localhost:5433/noshy_test` y `TEST_RABBITMQ_URL=amqp://noshy:noshy@localhost:5672` (crea antes la base `noshy_test`). Las colas de prueba usan el prefijo `noshy_test`, así que no tocan las de desarrollo.

## Estructura

Por módulos, como el backend anterior. Cada módulo agrupa todo lo suyo y expone su API pública en `index.ts`;
las dependencias entre módulos se arman en `container.ts`.

```
src/
  modules/<módulo>/
    <módulo>.service.ts       lógica de negocio; emite eventos por el outbox
    <módulo>.repository.ts    acceso a datos (Drizzle / Mongo)
    <módulo>.model.ts         tablas Drizzle del módulo (fuente de las migraciones)
    <módulo>.providers.ts     servicios externos del módulo (OAuth, correo, OCR, motor del chef, moderación, push)
    http/                     <módulo>.routes.ts · .controller.ts · .dto.ts (zod) · .middleware.ts
    events/                   <módulo>.observers.ts (GoF Observer: cómo reacciona a eventos de otros módulos)
    index.ts                  API pública del módulo

    account/        account.model, account.providers, account.repository, account.service  · http/ events/
    auth/           auth.model, auth.providers, auth.repository, auth.service, token.service  · http/
    authoring/      authoring.service  · http/
    catalog/        catalog.model, catalog.repository, catalog.service, ingredient-search.service  · http/
    chef/           chef.providers, chef.repository, chef.service, insights.service  · http/ events/
    community/      community.model, community.providers, community.service  · http/ events/
    cooking/        cooking.model, cooking.repository, cooking.service, cooking.snapshots, kitchen.service  · http/
    home/           days.service, home.service, meals.model, meals.repository, nudges.model, nudges.repository, nudges.service  · http/ events/
    media/          media.model, media.repository, media.service  · http/
    menus/          menus.model, menus.repository, menus.service  · http/ events/
    notifications/  notifications.providers events/
    onboarding/     onboarding.model, onboarding.service, preferences.repository, preferences.service  · http/
    pantry/         pantry-setup.service, pantry.model, pantry.repository, pantry.service  · http/
    profile/        profile.service  · http/
    receipts/       receipts.model, receipts.providers, receipts.repository, receipts.service  · http/ events/
    recipes/        nutrition.service, recipes.model, recipes.providers, recipes.repository, recipes.service, recommendations.service  · http/
    shopping/       shopping.model, shopping.repository, shopping.service  · http/ events/

  core/
    events/                   catálogo de eventos, DomainEvent + DomainEventFactory, event store, outbox + relay,
                              Subject/Observer, ledger de idempotencia, replay
    domain/                   reglas puras y testeables: nutrición, restricciones, cantidades, franjas, racha, puntaje
    shared/                   errores, ids con prefijo, cursores, tiempo y zona horaria, dto comunes
  infrastructure/
    config/env.ts             variables de entorno validadas con zod
    database/                 postgres (cliente, migrador, schema.ts que junta los modelos), mongo (cliente, colecciones), seed
    event-bus/                EventTransportFactory, register-observers, rabbitmq/ (topología, conexión, publisher, consumer)
    http/                     server.ts (Fastify, /health, /docs), routes.ts, middlewares/ (errores, idempotencia, zona horaria)
    ai/openrouter.client.ts   cliente de OpenRouter
    storage/                  storage local con URLs firmadas
    workers/scheduler.ts      tareas periódicas con advisory lock
    providers.factory.ts      GoF Factory de los providers de todos los módulos
  entrypoints/
    api.ts                    HTTP (+ consumer y scheduler si RUN_WORKERS=true)
    worker.ts                 consumer de RabbitMQ + relay + scheduler
    replay-events.ts          reconstruir proyecciones desde el event store
  container.ts                raíz de composición
```

## Bases de datos

| Postgres (transaccional, relacional) | Mongo del homelab (documental, alto volumen) |
| --- | --- |
| users, oauth_identities, refresh_tokens | chef_threads, chef_messages (bloques tipados) |
| user_preferences, onboarding_drafts | cooking_events (telemetría de modo cocina) |
| stores, dishes, ingredients, ingredient_substitutes, products, product_prices | user_signals, insights (aprendizaje del chef) |
| recipes, recipe_ingredients, recipe_adaptations, adaptation_proposals | |
| saved_recipes, liked_recipes, comments, follows | receipt_scans (salida cruda del OCR) |
| | products_slim (catálogo de alimentos, **solo lectura**) |
| pantry_items, shopping_lists, shopping_list_items, shopping_list_recipes | |
| meal_logs, menus, menu_entries, cooking_sessions | |
| receipts, receipt_items, media, nudges | |
| idempotency_keys, **event_store**, **outbox**, **processed_events** | |

### Buscador de ingredientes

`GET /catalog/ingredients/search` (despensa, lista de compras, crear receta) recomienda desde `products_slim` en Mongo (base `MONGO_FOOD_DB`, por defecto `food`; el usuario de `MONGO_URL` necesita rol `read` sobre ella), ordenado por relevancia (`modules/catalog/food-ranking.ts`). Los ingredientes base que coinciden van primero, porque son los que usan las recetas. Los alimentos de Mongo llegan con id `food_<_id>`; al agregarlos, `CatalogService.ensure` los copia a `ingredients` en Postgres. Si Mongo no responde en 2,5 s, el buscador sigue con lo que hay en Postgres.

## Event driven

```
 caso de uso ──misma transacción──► tablas de estado
      │                              + event_store (append-only, versión por usuario)
      │                              + outbox (entrega pendiente)
      ▼
 OutboxRelay (api y worker · FOR UPDATE SKIP LOCKED · orden por usuario · backoff · dead)
      │  publish con confirms, routing key = tipo del evento
      ▼
 RabbitMQ ── noshy.events (topic) ──#──► noshy.events.observers
                                              │            │ falla un observer
                                              │            ├─► noshy.events.retry.{5s,30s,2m,10m} ─┐ (TTL: vuelve)
                                              │            └─► agotó → noshy.dlx ─► noshy.dead-letters
                                              ▼                                                     │
 worker: consumer ─► SubjectRegistry ─► Subject del usuario ─► Observers ◄─────────────────────────┘
                                         (en orden)            (idempotentes vía processed_events;
                                                                 pueden emitir más eventos)
```

- **Event store** (`event_store`): cada evento queda con `streamId` (el usuario), `version` (1, 2, 3… dentro del stream) y `globalPosition`. Un trigger impide los UPDATE. Es la fuente para reconstruir proyecciones (`pnpm events:replay`) y para «Descargar mis datos» (sección `activity`). Al borrar la cuenta se purga el stream y queda solo la lápida `user.deleted`.
- **Transactional outbox** (`outbox`): se escribe en la misma transacción que el evento y el cambio de estado. Un evento existe y se entrega **si y solo si** la transacción se confirmó. Para versionar sin choques, `append` toma un advisory lock por stream (`pg_advisory_xact_lock`), con `lock_timeout` de 10 s.
- **Relay**: la API publica apenas confirma (kick) y el worker barre lo que quede (poll). Si RabbitMQ está caído, los eventos esperan en el outbox con backoff y salen cuando vuelve; tras `OUTBOX_MAX_ATTEMPTS` quedan `dead` para revisión.
- **RabbitMQ**: misma topología del backend anterior (`noshy.events`, `noshy.events.observers`, `noshy.dlx`, `noshy.dead-letters`) más las colas de espera. Publisher confirms, mensajes persistentes, reconexión automática (vuelve a declarar la topología y a suscribirse).
- **GoF Observer**: `EventSubject` (uno por usuario, creado bajo demanda por `SubjectRegistry`) notifica a los `Observer` interesados y serializa los eventos del mismo usuario. Si un observer falla, se reintenta el mensaje y los que ya lo procesaron se lo saltan (`processed_events`). Los observers viven en `src/modules/<módulo>/events/` y extienden `EventObserver` (`this.on('tipo', handler)`).
- **GoF Factory**: `DomainEventFactory` crea y rehidrata eventos (desde el store o desde el mensaje de RabbitMQ) y rechaza tipos desconocidos; `EventTransportFactory` elige RabbitMQ o en proceso; `ProviderFactory` elige storage, OCR, chef (OpenRouter o reglas), etc.
- **Sin broker** (`EVENT_TRANSPORT=in-process` o sin `RABBITMQ_URL`): el relay notifica a los Subjects en el mismo proceso. Sirve para tests y para una sola máquina; en producción se avisa en el log.

**Regla de diseño:** lo que la respuesta del contrato necesita se hace síncrono dentro de la transacción del caso de uso (ej. terminar de cocinar devuelve el día actualizado y lo descontado de la despensa). Lo derivado va por eventos.

| Evento | Observers |
| --- | --- |
| `user.registered` | `account`: envía el código de verificación |
| `onboarding.completed` | `menus`: genera el primer menú |
| `menu.generated` | `shopping`: arma la lista con lo que falta · `notifications`: «Tu menú está listo» |
| `menu.entry_added` / `_changed` / `_removed` | `shopping`: la lista sigue al menú (agrega y quita recetas) |
| `data_export.requested` | `account`: arma el JSON con todos los datos (incluido el stream de eventos) y avisa por correo |
| `user.deleted` | `account`: borra Mongo, archivos y el stream del event store (las recetas publicadas quedan retiradas y anónimas) |
| `receipt.uploaded` | `receipts`: OCR + matching → despensa → `receipt.parsed` / `receipt.failed` |
| `receipt.parsed` | `chef`: mensaje proactivo («Vi que compraste pollo y tomate el martes») · `learning`: señales de marca → insights · `notifications` |
| `cooking.completed` | `learning`: señales → insights («Los martes prefieres platos cremosos») · `nudges`: avisos (variedad) |
| `pantry.*` | `nudges`: recalcula avisos de vencimiento («Tu espinaca vence mañana») |
| `pantry.item_removed` (con «agregar a la lista») | `shopping`: agrega el ingrediente a la lista de compras |
| `shopping.item_swapped` | `learning`: señal de marca preferida |
| `recipe.publish_requested` | `community`: moderación → estructura para modo cocina → `recipe.published` / `recipe.rejected` |
| `comment.created`, `recipe.published`, `recipe.rejected` | `notifications`: push al autor |
| `chef.feedback_given`, `recipe.liked`, `meal.logged`, `cooking.events_recorded` | `learning`: señales de aprendizaje (proyección reconstruible con `events:replay`) |

## Decisiones que vienen del contrato

- **Calorías:** la fórmula vive en `core/domain/nutrition.ts`. El front solo reescala con `macroSplit`; el backend recalcula al guardar.
- **Restricciones y adaptación:** `core/domain/restrictions.ts` decide compatibilidad y sustituciones (crema → bebida de avena por lactosa; pasta → pasta de garbanzo por más proteína). La adaptación se persiste con ID estable y se recrea si cambian las preferencias, conservando las propuestas aplicadas (airfryer).
- **Cantidades:** `{ value, unit, display }`; el backend escala y escribe «2 dientes», «al gusto», «todo».
- **Modo cocina:** la sesión trae todos los pasos escalados y adaptados, con alertas de cambio de calor calculadas (`heatChange`). El timer vive en el front; los eventos llegan en lote y se deduplican.
- **Chat:** `POST /me/chef/threads/{id}/messages` responde por SSE con `Accept: text/event-stream` o JSON sin él. Idempotente por `clientMessageId`.
- **Idempotency-Key:** middleware que guarda la primera respuesta por usuario + ruta y la repite con `Idempotent-Replayed: true`.
- **Zona horaria:** `X-Timezone` en cada request; se guarda la última en `users.timezone` para los workers.
- **Menú y lista:** el onboarding crea el menú por evento; la lista se arma desde el menú menos la despensa.

## Proveedores enchufables (qué hay que conectar para producción)

| Puerto | Implementación incluida | Para producción |
| --- | --- | --- |
| `Storage` | `LocalStorage`: URLs firmadas con HMAC hacia `/api/v1/storage/upload` | S3/GCS con URL prefirmada (misma interfaz) |
| `ReceiptParser` | `MockReceiptParser` (factura de ejemplo) · `none` | Servicio de OCR o modelo de visión |
| `ChefEngine` | `LlmChefEngine` (OpenRouter, modelos gratis) si hay `OPENROUTER_API_KEY`: responde el texto libre eligiendo solo entre recetas reales y compatibles; si falla, cae a `RuleBasedChefEngine`, que cubre los flujos del diseño (ideas, otra idea, ¿qué compro?, más proteína, airfryer, congelar) | Ajustar prompt y modelos (`OPENROUTER_MODEL`) |
| `Moderation` | Reglas básicas de spam | Servicio de moderación de texto e imágenes |
| `OAuthVerifier` | Verifica idTokens de Google y Apple con sus JWKS | Configura `GOOGLE_CLIENT_IDS` y `APPLE_CLIENT_IDS` |
| `Notifier` | Registra en el log (respeta Ajustes › Notificaciones) | FCM / APNs |
| `Mailer` | Registra en el log (código de verificación, exportación lista) | SES / Resend / SendGrid |
| `NutritionEstimator` | Tabla de platos colombianos + recetas + ingredientes del catálogo | Modelo de lenguaje con la misma interfaz |

## Endpoints

85 operaciones. La referencia completa con esquemas está en `/docs`. Resumen:

- **Cuenta:** `POST /auth/register`, `POST /auth/oauth/{provider}`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/email/verify`, `POST /auth/email/resend`
- **Ajustes:** `GET|PATCH /me/settings`, `POST /me/data-exports`, `GET /me/data-exports/{id}`, `GET /me/data-exports/{id}/download`, `DELETE /me`
- **Onboarding:** `GET /onboarding/options`, `POST /nutrition/targets/preview`, `GET|PATCH /me/onboarding`, `POST /me/onboarding/complete`, `GET /me/menus/{id}`, `POST /me/menus/{id}/retry`
- **Mi semana:** `GET /me/menus/current`, `POST /me/menus/{id}/entries`, `PATCH|DELETE /me/menus/{id}/entries/{entryId}`, `POST /me/menus/{id}/shopping-list`
- **Tu despensa (onboarding):** `GET /me/pantry/suggestions`, `POST /me/pantry/bulk`
- **Facturas:** `POST /me/receipts` (multipart), `GET /me/receipts/{id}`, `GET /me/receipts/{id}/items`, `PATCH /me/receipts/{id}/items/{itemId}`
- **Inicio:** `GET /me/home`, `GET /me/days/{date}`, `POST /me/days/{date}/meals`, `DELETE /me/days/{date}/meals/{id}`, `GET /me/recommendations`, `GET /me/nudges`, `POST /me/nudges/{id}/dismiss`, `POST /nutrition/estimate`
- **Tu chef:** `POST /me/chef/threads`, `GET|POST /me/chef/threads/{id}/messages`, `POST /me/chef/threads/{id}/read`, `POST /me/chef/messages/{id}/feedback`, `GET /me/chef/insights`, `POST /me/chef/insights/{id}/feedback`
- **Mi despensa:** `GET /me/pantry/overview`, `GET /me/pantry`, `POST /me/pantry/items`, `PATCH|DELETE /me/pantry/{id}`
- **Lista de compras:** `GET /me/shopping-lists/current`, `POST /me/shopping-lists/current/items`, `POST /me/shopping-lists/current/recipes`, `PATCH /me/shopping-lists/{id}/items/{itemId}`, `POST …/items/{itemId}/swap`, `POST …/share`, `POST …/checkout`, `GET /shared/lists/{token}` (público)
- **Mi cocina:** `GET /me/cooked-recipes`
- **Recetas:** `GET /recipes/{id}`, `POST /recipes/{id}/adaptations`, `PUT|DELETE /me/saved-recipes/{id}`, `PUT|DELETE /me/liked-recipes/{id}`
- **Modo cocina:** `POST /me/cooking-sessions`, `GET /me/cooking-sessions/active`, `GET /me/cooking-sessions/{id}`, `POST …/events`, `POST …/complete`, `POST …/abandon`
- **Comunidad:** `GET /community/feed`, `GET /community/creators`, `GET|POST /community/recipes/{id}/comments`, `PUT|DELETE /me/following/{userId}`
- **Crear receta:** `POST /media/uploads`, `POST /me/recipes`, `PATCH /me/recipes/{id}`, `POST /me/recipes/{id}/publish`, `GET /me/recipes`, `GET /catalog/ingredients/search`
- **Perfil:** `GET /me/profile`, `PATCH /me/preferences`

## Siguiente

- Conectar los proveedores reales de producción: OCR de facturas, correo, push y S3/GCS.
- Cambio de email desde Ajustes (hoy solo se editan nombre, apellido, género y foto).
- Panel de operación para `noshy.dead-letters` y el outbox en `dead` (hoy se revisan desde el panel de RabbitMQ y con SQL).
- Migrar el frontend: las rutas del backend anterior (`/food`, `/plans`, `/inventory`…) ya no existen; el mapa está en el contrato v0.3.
