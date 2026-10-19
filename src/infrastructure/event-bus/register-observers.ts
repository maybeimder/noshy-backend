import { DomainEventFactory } from '../../core/events/domain-event.factory';
import type { Outbox } from '../../core/events/event-store';
import { OutboxRelay } from '../../core/events/outbox-relay';
import { SubjectRegistry, type EventDispatcher } from '../../core/events/subject';
import { PreferenceEngine } from '../../modules/chef-sessions/events/chef-sessions.observers';
import { RecommendationEngine } from '../../modules/recommendations/events/recommendations.observers';
import { CommunityNotificationEngine } from '../../modules/recipes/events/recipes.observers';
import { applicationLogger } from '../observability/logger';
import { getEventStore } from './event-bus';
import { domainEventTypes } from './events';

// Observers del sistema (proyecciones). Cada Subject de usuario los recibe a todos.
export const recommendationEngine = new RecommendationEngine();
export const preferenceEngine = new PreferenceEngine();
export const communityNotificationEngine = new CommunityNotificationEngine();
export const observers = [recommendationEngine, preferenceEngine, communityNotificationEngine];

export const eventFactory = new DomainEventFactory(domainEventTypes);
export const subjectRegistry = new SubjectRegistry(observers);

// dispatcher: subjectRegistry = observers en este proceso; RabbitMqEventPublisher = publica en RabbitMQ.
// store: el outbox en memoria (por defecto) o PostgresEventStore.
export function createOutboxRelay(store: Outbox = getEventStore(), dispatcher: EventDispatcher = subjectRegistry): OutboxRelay {
  return new OutboxRelay(store, eventFactory, dispatcher, {
    onError: (error, messageId) =>
      applicationLogger.error('outbox.dispatch_failed', `El outbox no pudo entregar el mensaje ${messageId}`, {
        messageId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }),
    onDispatched: (messageId, eventName, userId) =>
      applicationLogger.debug('outbox.dispatched', `Evento entregado: ${eventName}`, { messageId, eventName, userId })
  });
}

// Arranca el relay del outbox (polling). Devuelve la función para detenerlo.
export function startEventProcessing(
  intervalMs = 250,
  dispatcher: EventDispatcher = subjectRegistry,
  store: Outbox = getEventStore()
): () => void {
  applicationLogger.info('outbox.relay.started', `Outbox relay iniciado (polling cada ${intervalMs} ms).`, { intervalMs });
  return createOutboxRelay(store, dispatcher).start(intervalMs);
}
