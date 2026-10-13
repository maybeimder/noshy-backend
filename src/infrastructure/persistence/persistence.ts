import { InMemoryUnitOfWork, type EventAppender, type UnitOfWork } from '../../core/persistence/unit-of-work';
import { InMemoryUserRepository, type UserRepository } from '../../modules/auth/auth.repository';
import { InMemoryChefSessionRepository, type ChefSessionRepository } from '../../modules/chef-sessions/chef-session.repository';
import { InMemoryPreferencesRepository, type PreferencesRepository } from '../../modules/chef-sessions/preferences.repository';
import { InMemoryFeedbackRepository, type FeedbackRepository } from '../../modules/feedback/feedback.repository';
import { InMemoryInventoryRepository, type InventoryRepository } from '../../modules/inventory/inventory.repository';
import { InMemoryPlanRepository, type PlanRepository } from '../../modules/plans/plan.repository';
import { InMemoryRecipeRepository, type RecipeRepository } from '../../modules/recipes/recipe.repository';
import { getEventStore } from '../event-bus/event-bus';

// Todo lo que los servicios necesitan para leer/escribir. Una sola implementación activa por proceso.
export interface Persistence {
  uow: UnitOfWork;
  events: EventAppender;
  users: UserRepository;
  plans: PlanRepository;
  inventory: InventoryRepository;
  recipes: RecipeRepository;
  chefSessions: ChefSessionRepository;
  preferences: PreferencesRepository;
  feedback: FeedbackRepository;
}

export function createInMemoryPersistence(): Persistence {
  return {
    uow: new InMemoryUnitOfWork(),
    // Se resuelve en cada llamada para respetar setEventStore() (tests).
    events: {
      append: async (events) => void getEventStore().append(events),
      readStream: async (streamId) => getEventStore().readStream(streamId)
    },
    users: new InMemoryUserRepository(),
    plans: new InMemoryPlanRepository(),
    inventory: new InMemoryInventoryRepository(),
    recipes: new InMemoryRecipeRepository(),
    chefSessions: new InMemoryChefSessionRepository(),
    preferences: new InMemoryPreferencesRepository(),
    feedback: new InMemoryFeedbackRepository()
  };
}

let current: Persistence = createInMemoryPersistence();

export function db(): Persistence {
  return current;
}

// Lo llama el entrypoint (Postgres si hay DATABASE_URL) o un test.
export function configurePersistence(persistence: Persistence): void {
  current = persistence;
}
