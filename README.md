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
Copy-Item .env.example .env       # y completa DATABASE_URL, RABBITMQ_URL, JWT_SECRET, OPENROUTER_API_KEY
pnpm dev                          # API: migra al arrancar, HTTP + comandos por RabbitMQ + relay del outbox
pnpm dev:worker                   # Worker: consume eventos y alimenta los observers
```

La API, el worker y `pnpm db:migrate` cargan `backend/.env` al arrancar (las variables de la terminal tienen prioridad). Los tests no lo leen.

Para probar la API a mano usa la colección de [Bruno](bruno/README.md) (46 requests del flujo MVP, con guía paso a paso). Desde la terminal: `pnpm test:bruno` con la API corriendo.

Con `DATABASE_URL` y `RABBITMQ_URL` definidas, `pnpm test` también corre los tests de integración contra Postgres y RabbitMQ reales (usan schemas y exchanges temporales y los borran al terminar).

## Despliegue con Docker (homelab / server)

Todo corre en contenedores en **modo dev** (`tsx watch`, sin compilar): Postgres, RabbitMQ, la API y el worker, con reinicio automático. Solo hace falta Docker y git (no Node ni pnpm).

```bash
git clone --recurse-submodules -b dev https://github.com/maybeimder/noshy.git
cd noshy/backend
cp .env.example .env    # define JWT_SECRET (para que los tokens sobrevivan reinicios) y OPENROUTER_API_KEY
```

**Con dominio + HTTPS** (script `web-deploy`, Nginx + Certbot): desde `noshy/backend`,

```bash
sudo web-deploy api.tudominio.com -e tu@email.com
# cuando pregunte el puerto HOST: 3000
```

**Sin dominio** (solo red local): pon `API_BIND=0.0.0.0` en `.env` y `docker compose up -d --build`; la API queda en `http://<ip-del-server>:3000`.

- `api` es el primer servicio del compose a propósito: `web-deploy` genera su override de puertos para el primero. Ese override (`docker-compose.override.yml`) está en `.gitignore`.
- Todo escucha en `127.0.0.1` del server; con `web-deploy` solo Nginx (80/443) queda expuesto. Para el panel de RabbitMQ desde tu PC: `ssh -L 15672:localhost:15672 <server>` y abre http://localhost:15672 (`noshy` / `noshy`).
- La API aplica las migraciones al arrancar. Los datos viven en el volumen `noshy-postgres-data`.
- CORS queda en `*` mientras no definas `CORS_ORIGIN`, así que el frontend puede llamar desde cualquier IP.
- `./src` está montado en los contenedores: tras un `git pull`, `tsx watch` recarga solo en Linux. Si no lo hace (o cambiaron dependencias), usa la tabla de abajo.

| Tarea | Comando |
| ----- | ------- |
| Actualizar código (solo `src/`) | `git pull && docker compose restart api worker` |
| Actualizar dependencias (`package.json`) | `git pull && docker compose up -d --build` |
| Ver logs | `docker compose logs -f api worker` |
| Estado | `docker compose ps` |
| Reiniciar | `docker compose restart api worker` |
| Apagar (conserva los datos) | `docker compose down` |
| Respaldar la base | `docker exec noshy-postgres pg_dump -U noshy noshy > backup.sql` |

Para desarrollo en tu máquina sigue usando `pnpm infra:up` (solo Postgres + RabbitMQ) y `pnpm dev`.

`pnpm build` + `pnpm start` también funcionan (compilan a `dist/` como CommonJS), pero el despliegue actual no los usa.

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
| `MONGO_URL`          | —               | Catálogo de alimentos y recetas (Mongo de solo lectura). Sin ella, `/food` devuelve 503 |

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
| Alimentos        | `GET /food/products?q=`, `GET /food/products/:id`, `POST /food/macros`, `GET /food/history` |
| Recetas IA (RAG) | `GET /food/library/browse`, `GET /food/library/recipes?ingredients=`, `GET /food/library/recipes/:id`, `POST /food/recipes/generate`, `GET /food/recipes/:id` |

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

## Alimentos y recetas (MongoDB)

El módulo `food` consulta un MongoDB **de solo lectura** (base `food`, usuario con rol `read`), aparte de Postgres y RabbitMQ:

- **`products_slim`** (catálogo de ~7.6k alimentos): `GET /food/products?q=arroz blanco` para el dropdown. Normaliza el texto (minúsculas, sin tildes, sin conectores como "de"), exige todas las palabras y excluye `suspect`. Trae hasta 100 candidatos y los ordena por **relevancia** (`modules/food/food-ranking.ts`), no por popularidad: puntúa que la palabra sea el núcleo del nombre y palabra completa ("sal" ≠ "salchicha") y penaliza sabores ("sabor pollo", "limón pimienta"), procesados, marcas de snacks y mezclas. Cada resultado trae `exactMatch: true` cuando el producto ES el alimento buscado.
- **Ojo con los datos:** hoy el catálogo no tiene genéricos USDA (`source: "usda"`, `state`, `pairKey` están vacíos) ni varios básicos crudos (cebolla, ajo, zanahoria). Cuando no hay un match confiable, la receta generada omite ese ingrediente de los macros y lo avisa en `warnings`, en vez de sumar los de un snack.
- **Macros** (`POST /food/macros`): por gramos o por porción (`serving` + `quantity`); sin cantidad usa 100 g y lo avisa. Con `"log": true` registra la comida (evento `food.meal_logged`).
- **`recipes_raw`** (RecipeNLG, ~2.2M recetas en inglés, sin calorías): `GET /food/library/recipes?ingredients=pollo,arroz`. Los ingredientes se traducen al inglés con OpenRouter (con caché en memoria) y se buscan por `ner`.
- **Biblioteca paginada** (`GET /food/library/browse`): sin parámetros devuelve una página **aleatoria** de 20 recetas; `sort=recent|oldest` ordena por id del dataset (RecipeNLG no tiene fechas, así que "recent" son las últimas agregadas). Filtros: `source` (`Gathered`/`Recipes1M`) y `maxIngredients`. Paginación por cursor (`nextCursor`, sin `skip`): cualquier página cuesta lo mismo, también en modo aleatorio, que arranca en un id al azar y recorre toda la colección sin repetir. Cada tarjeta trae `tags` e `image` (hoy siempre `null`: el dataset no trae imágenes).
- **RAG** (`POST /food/recipes/generate`): trae recetas de referencia, el modelo de OpenRouter redacta una receta en español y **el back calcula los macros** cruzando cada ingrediente con `products_slim` (en recetas, sin indicación se asume crudo). Registra `food.recipe_generated` y devuelve `recipeInput`, listo para `POST /recipes`.
- **Tags de recetas** (`tags` en la biblioteca y en las recetas generadas): `diet` (vegetariana, vegana), `allergens` (gluten, leche, huevo, maní, frutos secos, soya, pescado, mariscos, ajonjolí), `mealTypes` (postre, sopa, ensalada, desayuno, salsa… o el tipo que da el modelo), `proteins` (pollo, res, cerdo, pescado, legumbres…), `nutrition` (alto en proteína, bajo en carbohidratos… solo con macros) y `effort` (pocos ingredientes, rápida). Se deducen con un léxico bilingüe (`modules/food/food-tags.ts`) más los alérgenos y grupos de los productos del catálogo. Son orientativos: `allergens` lista lo detectado y nunca se afirma "sin gluten".
- **Historial** (`GET /food/history`, `GET /food/recipes/:id`): no tiene tabla propia, se reconstruye reproduciendo los eventos `food.*` del usuario (Event Sourcing).

Todo pasa por el `CommandBus` (`food.*` en `modules/food/events/food.handlers.ts`), así que también se puede disparar por RabbitMQ. El adaptador (`infrastructure/database/mongo/`) solo usa `find` y `aggregate`, con proyección, `limit` y `maxTimeMS`; el texto del usuario se escapa antes de entrar a un regex y los DTO rechazan objetos (`{ "$ne": "" }`). Si Mongo no responde al arrancar, la API sigue arriba, reintenta con backoff y responde 503 mientras tanto. Al conectar avisa en el log si faltan los índices `products_slim.popularity` o `recipes_raw.ner`.

RecipeNLG es solo para uso educativo/investigación no comercial: se usa como referencia interna, no se redistribuye.

El frontend y Redis están fuera del alcance de este submódulo en la etapa actual.

---
# DIAGRAMAS

. C1 — Contexto del sistema

```mermaid
flowchart TB
    user(["👤 Usuario<br/><i>Persona que planea comidas,<br/>gestiona despensa y recetas</i>"])

    subgraph noshy ["Noshy"]
        sys["<b>Noshy</b><br/>Planes nutricionales, despensa, recetas,<br/>lista de compras, agente chef con IA"]
    end

    openrouter["OpenRouter<br/><i>[Sistema externo]</i><br/>LLM para agente chef y redactor de recetas"]
    mongo[("MongoDB catálogo<br/><i>[Sistema externo, solo lectura]</i><br/>alimentos + recetas RecipeNLG")]
    deploy["web-deploy / Nginx + Certbot<br/><i>[Infra del homelab]</i><br/>HTTPS y reverse proxy"]

    user -- "usa (HTTPS)" --> sys
    sys -- "completions JSON (HTTPS)" --> openrouter
    sys -- "consulta alimentos/recetas (MongoDB wire)" --> mongo
    deploy -. "publica :3000" .- sys

    classDef person fill:#08427b,color:#fff,stroke:#052e56
    classDef system fill:#1168bd,color:#fff,stroke:#0b4884
    classDef ext fill:#999,color:#fff,stroke:#6b6b6b
    class user person
    class sys system
    class openrouter,mongo,deploy ext
```

---

## 2. C2 — Contenedores

Dos procesos Node.js con **la misma imagen** (`Dockerfile`, `docker-compose.yml`): `api` y `worker`.

```mermaid
flowchart TB
    user(["👤 Usuario"])

    subgraph noshy ["Noshy"]
        spa["<b>Frontend SPA</b><br/><i>React 19 · Vite · TanStack Query · axios</i><br/>noshy-frontend"]

        subgraph backend ["noshy-backend (misma imagen Docker)"]
            api["<b>API</b><br/><i>Node 22 · Express 5 · Zod</i><br/>entrypoints/api.ts<br/>HTTP + CommandBus + OutboxRelay"]
            worker["<b>Worker</b><br/><i>Node 22</i><br/>entrypoints/worker.ts<br/>consume eventos → Observers"]
        end

        pg[("<b>PostgreSQL 17</b><br/>tablas de dominio + <code>event_store</code><br/>+ <code>outbox</code> + <code>processed_messages</code>")]
        rmq{{"<b>RabbitMQ 4</b><br/>exchanges <code>noshy.commands</code>,<br/><code>noshy.events</code>, <code>noshy.dlx</code>"}}
    end

    openrouter["OpenRouter<br/><i>[externo]</i>"]
    mongo[("MongoDB catálogo<br/><i>[externo, RO]</i>")]

    user --> spa
    spa -- "REST/JSON + JWT<br/>(HTTPS)" --> api
    api -- "SQL (pg) · 1 transacción por caso de uso<br/>estado + evento + outbox" --> pg
    api -- "Relay: lee outbox pending (poll 250 ms)<br/>publica evento con confirm" --> rmq
    rmq -- "cola noshy.commands.api<br/>(comandos RPC / fire-and-forget)" --> api
    rmq -- "cola noshy.events.observers" --> worker
    api -- "chat completions" --> openrouter
    api -- "find/aggregate" --> mongo

    classDef person fill:#08427b,color:#fff
    classDef cont fill:#438dd5,color:#fff,stroke:#2e6295
    classDef store fill:#2f6f9f,color:#fff
    classDef ext fill:#999,color:#fff
    class user person
    class spa,api,worker cont
    class pg,rmq store
    class openrouter,mongo ext
```

**Modo degradado (sin variables de entorno):** sin `DATABASE_URL` todo es memoria (`InMemoryEventStore`, repos in-memory); sin `RABBITMQ_URL` el relay entrega directo al `SubjectRegistry` del mismo proceso (`entrypoints/api.ts:117-131`). Por eso los tests corren sin infraestructura.

---

## 3. C3 — Componentes

### 3.1 Contenedor API

```mermaid
flowchart TB
    spa["Frontend SPA"]
    rmqcmd{{"RabbitMQ<br/>noshy.commands.api"}}
    pg[("PostgreSQL")]
    rmqev{{"RabbitMQ<br/>noshy.events"}}
    openrouter["OpenRouter"]
    mongo[("MongoDB")]

    subgraph api ["API — Express 5"]
        direction TB

        subgraph adapters_in ["Adaptadores de entrada (infrastructure/)"]
            http["<b>HTTP server + middlewares</b><br/>http/server.ts · requireAuth ·<br/>request-logger · error.middleware"]
            ctrl["<b>Controllers + Routes</b><br/>modules/*/http/*.controller.ts<br/>traducen req → comando (runHandler)"]
            rcons["<b>RabbitMqCommandConsumer</b><br/>event-bus/rabbitmq/"]
        end

        subgraph core_app ["Aplicación (core/ + modules/)"]
            bus["<b>CommandBus</b><br/>core/commands/command-bus.ts<br/>valida DTO · identidad ·<br/>idempotencia por messageId"]
            handlers["<b>Handlers</b><br/>modules/*/events/*.handlers.ts<br/>defineHandler(name, schema, execute)"]
            services["<b>Servicios / casos de uso</b><br/>auth · plans · inventory · recipes ·<br/>chef-sessions · feedback · food ·<br/>shopping-list"]
            events["<b>Eventos de dominio</b><br/>modules/*/events/*.events.ts<br/>extienden DomainEvent"]
            ports["<b>Puertos</b><br/>ChefAgentPort · FoodCatalogPort ·<br/>RecipeWriterPort · Repository*"]
            uowport["<b>UnitOfWork / EventAppender</b><br/>core/persistence/unit-of-work.ts"]
        end

        subgraph adapters_out ["Adaptadores de salida (infrastructure/)"]
            persist["<b>db() — Persistence</b><br/>persistence/persistence.ts<br/>(service locator)"]
            pgrepos["<b>Postgres repositories + UoW</b><br/>database/postgres-repositories.ts"]
            pges["<b>PostgresEventStore</b><br/>Event Store + Outbox"]
            relay["<b>OutboxRelay</b><br/>core/events/outbox-relay.ts<br/>poll 250 ms, reintentos, dead"]
            pub["<b>RabbitMqEventPublisher</b><br/>(EventDispatcher con publisher-confirm)"]
            oragent["<b>OpenRouterChefAgent / RecipeWriter</b><br/>ai/"]
            mcat["<b>MongoFoodCatalog</b><br/>database/mongo/"]
        end
    end

    spa --> http --> ctrl --> bus
    rmqcmd --> rcons --> bus
    bus --> handlers --> services
    services --> events
    services --> ports
    services --> uowport
    uowport -.implementa.-> persist
    persist --> pgrepos --> pg
    persist --> pges --> pg
    relay -- "pending()/markDispatched()" --> pges
    relay --> pub --> rmqev
    ports -.implementa.-> oragent --> openrouter
    ports -.implementa.-> mcat --> mongo

    classDef c fill:#85bbf0,color:#000,stroke:#5d82a8
    classDef ext fill:#999,color:#fff
    class http,ctrl,rcons,bus,handlers,services,events,ports,uowport,persist,pgrepos,pges,relay,pub,oragent,mcat c
    class spa,rmqcmd,pg,rmqev,openrouter,mongo ext
```

### 3.2 Contenedor Worker

```mermaid
flowchart TB
    rmq{{"RabbitMQ<br/>noshy.events.observers<br/>(DLX → noshy.dead-letters)"}}

    subgraph worker ["Worker"]
        cons["<b>RabbitMqEventConsumer</b><br/>ack / nack (1 reintento → DLX)"]
        fac["<b>DomainEventFactory</b><br/>nombre → clase de evento<br/>(registro: infrastructure/event-bus/events.ts)"]
        reg["<b>SubjectRegistry</b><br/>1 Subject por usuario (lazy)"]
        subj["<b>Subject (por usuario)</b><br/>attach / detach / notify"]
        o1["<b>RecommendationEngine</b><br/>IdempotentObserver<br/>→ RecommendationProjection"]
        o2["<b>PreferenceEngine</b><br/>IdempotentObserver<br/>gustos / disgustos"]
        o3["<b>CommunityNotificationEngine</b><br/>IdempotentObserver<br/>feed de recetas públicas"]
    end

    rmq --> cons --> fac --> reg --> subj
    subj --> o1
    subj --> o2
    subj --> o3

    classDef c fill:#85bbf0,color:#000,stroke:#5d82a8
    classDef ext fill:#999,color:#fff
    class cons,fac,reg,subj,o1,o2,o3 c
    class rmq ext
```

### 3.3 Módulos de dominio (bounded contexts)

Cada módulo repite la misma estructura (`http/` controller+routes+dto · `events/` handlers+events(+observers) · `*.service.ts` · `*.model.ts` · `*.repository.ts`).

| Módulo | Eventos que emite | Observers |
|---|---|---|
| `auth` | `auth.user_registered`, `auth.user_logged_in` | — |
| `plans` | `plans.nutrition_plan_created/updated` | — |
| `inventory` | `inventory.item_added/updated/removed` | — |
| `recipes` | `recipe_created/updated/deleted/published/unpublished` | `CommunityNotificationEngine` |
| `chef-sessions` | `chef.session_opened`, `chef.message_recorded`, `chef.session_closed`, `chef.session_recovery_required` | `PreferenceEngine` |
| `feedback` | `feedback.feedback_recorded` | `RecommendationEngine`, `PreferenceEngine` |
| `food` | `food.recipe_generated`, `food.meal_logged` | (se reproduce con `FoodHistoryProjection`) |
| `shopping-list` | `shopping.list_generated` | — |
| `recommendations` | — (solo proyección y observer) | `RecommendationEngine` |

---

## 4. C4 — Código (los tres flujos que importan)

### 4.1 Escritura con Transactional Outbox

Ejemplo: `publishRecipe` (`modules/recipes/recipe.service.ts`).

```mermaid
sequenceDiagram
    autonumber
    participant C as Controller / RabbitMqCommandConsumer
    participant B as CommandBus
    participant S as recipe.service
    participant U as UnitOfWork (Postgres)
    participant R as RecipeRepository
    participant E as PostgresEventStore
    participant DB as PostgreSQL
    participant L as OutboxRelay (API, poll 250ms)
    participant P as RabbitMqEventPublisher
    participant X as RabbitMQ noshy.events
    participant W as Worker (EventConsumer)
    participant SJ as Subject(userId)
    participant O as Observers

    C->>B: dispatch({name:'recipes.publish', userId, params})
    B->>B: schema.safeParse · userId · messageId duplicado?
    B->>S: execute → publishRecipe()
    S->>U: transaction(tx => …)
    activate U
    U->>DB: BEGIN
    S->>R: update(recipe, tx)
    R->>DB: UPDATE recipes
    S->>E: append([RecipePublishedEvent], tx)
    E->>DB: INSERT event_store (stream=userId, version+1)
    E->>DB: INSERT outbox (status='pending')
    U->>DB: COMMIT  (los 3 cambios o ninguno)
    deactivate U
    S-->>C: resultado → HTTP 200

    Note over L,DB: Asíncrono, desacoplado de la request
    L->>E: pending(100)
    E->>DB: SELECT outbox JOIN event_store WHERE pending ORDER BY global_position
    L->>P: dispatch(DomainEvent)
    P->>X: publish (persistent, confirm)
    X-->>P: ack del broker
    L->>E: markDispatched(id)
    Note over L: si falla: markFailed (attempts++), se bloquea el stream del usuario y a los 5 intentos queda dead

    X->>W: noshy.events.observers
    W->>SJ: dispatch(event) (DomainEventFactory rehidrata)
    SJ->>O: update(event, userId)  — IdempotentObserver descarta eventId repetido
    W->>X: ack
```

Garantías: **at-least-once** end-to-end (el relay reintenta; el worker puede recibir duplicados) + **idempotencia** (`IdempotentObserver` por `eventId`; `CommandBus` por `messageId` en `processed_messages`) + **orden por usuario** (stream bloqueado mientras uno de sus eventos falla).

### 4.2 Clases: Observer, Outbox, Event Sourcing

```mermaid
classDiagram
    direction LR

    class DomainEvent~TPayload~ {
        <<abstract>>
        +eventName: string (static)
        +payload: TPayload
        +eventId: string
        +occurredAt: string
        +userId: string
    }
    class RecipePublishedEvent
    class FeedbackRecordedEvent
    DomainEvent <|-- RecipePublishedEvent
    DomainEvent <|-- FeedbackRecordedEvent

    class DomainEventFactory {
        <<Factory>>
        -typesByName: Map
        +register(type)
        +create(StoredEvent) DomainEvent
    }
    DomainEventFactory ..> DomainEvent : instancia por nombre

    class EventDispatcher {
        <<interface>>
        +dispatch(event)
    }
    class SubjectRegistry {
        +subjectFor(userId) Subject
        +dispatch(event)
    }
    class Subject {
        <<Subject GoF>>
        +userId
        +attach(Observer)
        +detach(Observer)
        +notify(event)
    }
    class Observer {
        <<interface>>
        +update(event, userId)
    }
    class IdempotentObserver {
        <<abstract, Template Method>>
        -processed: Set~eventId~
        +update(event, userId)
        +reset()
        #handle(event, userId)*
        #clearState()*
    }
    class RecommendationEngine
    class PreferenceEngine
    class CommunityNotificationEngine

    EventDispatcher <|.. SubjectRegistry
    EventDispatcher <|.. RabbitMqEventPublisher
    SubjectRegistry "1" o-- "*" Subject
    Subject "1" o-- "*" Observer
    Observer <|.. IdempotentObserver
    IdempotentObserver <|-- RecommendationEngine
    IdempotentObserver <|-- PreferenceEngine
    IdempotentObserver <|-- CommunityNotificationEngine

    class OutboxRelay {
        +drain()
        +drainAll()
        +start(intervalMs)
    }
    class Outbox {
        <<interface>>
        +pending(limit)
        +markDispatched(id)
        +markFailed(id, err, max)
    }
    class PersistentEventStore {
        <<interface>>
        +append(events, tx)
        +readStream(streamId)
        +readAll()
    }
    class PostgresEventStore
    class InMemoryEventStore
    Outbox <|.. PostgresEventStore
    PersistentEventStore <|.. PostgresEventStore
    Outbox <|.. InMemoryEventStore
    OutboxRelay --> Outbox
    OutboxRelay --> DomainEventFactory
    OutboxRelay --> EventDispatcher
```

### 4.3 Factory Method de agentes chef (existe, sin conectar)

```mermaid
classDiagram
    direction LR
    class ChefAgentFactory {
        <<Creator abstract>>
        +createAgent()* ChefAgent
        +restoreAgent(history) ChefAgent
    }
    class KetoAgentFactory
    class VeganAgentFactory
    class EconomicAgentFactory
    class ChefAgent {
        <<Product abstract>>
        +generatePlan(profile)*
        +suggestSubstitution(ing, restr)*
        +learn(interaction)
        +replay(history)
    }
    class KetoAgent
    class VeganAgent
    class EconomicAgent
    class Agents_ts {
        <<registry>>
        +assignChefAgent(DietType)
        +restoreChefAgent(DietType, history)
    }

    ChefAgentFactory <|-- KetoAgentFactory
    ChefAgentFactory <|-- VeganAgentFactory
    ChefAgentFactory <|-- EconomicAgentFactory
    ChefAgent <|-- KetoAgent
    ChefAgent <|-- VeganAgent
    ChefAgent <|-- EconomicAgent
    KetoAgentFactory ..> KetoAgent : crea
    VeganAgentFactory ..> VeganAgent : crea
    EconomicAgentFactory ..> EconomicAgent : crea
    Agents_ts --> ChefAgentFactory
```

---

