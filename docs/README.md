# Arquitectura de eventos

Cómo viaja un evento en el backend: desde el caso de uso que cambia el estado hasta los observers que reaccionan, con el código y su ubicación.

| Documento | Contenido |
| --- | --- |
| [01 · Transactional Outbox](01-transactional-outbox.md) | Tablas de Postgres, escritura atómica, relay, reintentos, idempotencia |
| [02 · Event driven y buses](02-event-driven.md) | Bus de comandos, bus de eventos, procesos, catálogo y mapa de eventos |
| [03 · RabbitMQ](03-rabbitmq.md) | Topología, conexión, publicación, consumo, reintentos y dead letters |
| [04 · GoF Observer](04-gof-observer.md) | Subject, registro de Subjects, observers concretos |
| [05 · GoF Factory](05-gof-factory.md) | Fábricas de eventos, transporte y proveedores |

Las rutas y los números de línea corresponden al código de este repositorio en el momento de escribir el documento. `GET /docs` de la API es otra cosa: la referencia OpenAPI de los endpoints.

## El ciclo

```
 1  HTTP            routes → controller → CommandBus → handler → service
 2  Transacción     ┌ cambio de estado (tablas del módulo)
                    ├ event_store (historial, versión por usuario)
                    └ outbox (entrega pendiente)
                    COMMIT
 3  kick            el service despierta al relay después del commit
 4  OutboxRelay     reclama filas pending (FOR UPDATE SKIP LOCKED) y llama al dispatcher
 5  Dispatcher      RabbitMqEventPublisher → exchange noshy.events (con confirm del broker)
                    → outbox: dispatched
 6  RabbitMQ        noshy.events ──#──► noshy.events.observers
 7  Consumer        RabbitMqEventConsumer (proceso worker) → DomainEventFactory.fromEnvelope
 8  Subject         SubjectRegistry → EventSubject del usuario
 9  Observers       update(event), uno por uno; processed_events evita repetir
10  ack             o cola de espera y, al agotar los reintentos, dead letters
```

## Dónde está cada pieza

| Pieza | Archivo |
| --- | --- |
| **Bus de comandos** | [`src/core/commands/command-bus.ts`](../src/core/commands/command-bus.ts) |
| Handlers de comandos | `src/modules/<módulo>/commands/*.commands.ts` |
| Catálogo de eventos (contrato entre módulos) | [`src/core/events/catalog.ts`](../src/core/events/catalog.ts) |
| Evento de dominio y su forma en el cable | [`src/core/events/domain-event.ts`](../src/core/events/domain-event.ts) |
| **Factory** de eventos | [`src/core/events/domain-event.factory.ts`](../src/core/events/domain-event.factory.ts) |
| Event store | [`src/core/events/event-store.ts`](../src/core/events/event-store.ts) |
| **Transactional Outbox** y relay | [`src/core/events/outbox.ts`](../src/core/events/outbox.ts) |
| Tablas `event_store`, `outbox`, `processed_events` | [`src/infrastructure/database/postgres/infra.model.ts`](../src/infrastructure/database/postgres/infra.model.ts) |
| Migración de esas tablas | [`drizzle/0002_event_store_rabbitmq.sql`](../drizzle/0002_event_store_rabbitmq.sql) |
| **Observer** (interfaz y clase base) | [`src/core/events/observer.ts`](../src/core/events/observer.ts) |
| **Subject** y registro | [`src/core/events/subject.ts`](../src/core/events/subject.ts) |
| Idempotencia de observers | [`src/core/events/ledger.ts`](../src/core/events/ledger.ts) |
| Puerto del **bus de eventos** | [`src/core/events/transport.ts`](../src/core/events/transport.ts) |
| Sistema de eventos (une todo) | [`src/core/events/system.ts`](../src/core/events/system.ts) |
| **Factory** del transporte | [`src/infrastructure/event-bus/event-transport.factory.ts`](../src/infrastructure/event-bus/event-transport.factory.ts) |
| **RabbitMQ** | [`src/infrastructure/event-bus/rabbitmq/`](../src/infrastructure/event-bus/rabbitmq/) |
| Observers concretos | `src/modules/<módulo>/events/*.observers.ts` |
| Registro de observers | [`src/infrastructure/event-bus/register-observers.ts`](../src/infrastructure/event-bus/register-observers.ts) |
| **Factory** de proveedores | [`src/infrastructure/providers.factory.ts`](../src/infrastructure/providers.factory.ts) |
| Composición | [`src/container.ts`](../src/container.ts) |
| Procesos | [`src/entrypoints/api.ts`](../src/entrypoints/api.ts), [`src/entrypoints/worker.ts`](../src/entrypoints/worker.ts) |
| Pruebas | [`test/integration/events.test.ts`](../test/integration/events.test.ts) |
