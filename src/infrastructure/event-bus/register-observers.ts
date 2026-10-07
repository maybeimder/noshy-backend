import { DomainEventFactory } from '../../core/events/domain-event.factory';
import { OutboxRelay } from '../../core/events/outbox-relay';
import { SubjectRegistry, type EventDispatcher } from '../../core/events/subject';
import { PreferenceEngine } from '../../modules/chef-sessions/events/chef-sessions.observers';
import { RecommendationEngine } from '../../modules/recommendations/events/recommendations.observers';
import { CommunityNotificationEngine } from '../../modules/recipes/events/recipes.observers';
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
export function createOutboxRelay(store = getEventStore(), dispatcher: EventDispatcher = subjectRegistry): OutboxRelay {
  return new OutboxRelay(store, eventFactory, dispatcher);
}

// Arranca el relay del outbox (polling). Devuelve la función para detenerlo.
export function startEventProcessing(intervalMs = 250, dispatcher: EventDispatcher = subjectRegistry): () => void {
  return createOutboxRelay(getEventStore(), dispatcher).start(intervalMs);
}
