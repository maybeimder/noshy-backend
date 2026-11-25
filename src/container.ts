import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './infrastructure/config/env.js';
import { createPostgres, type Postgres } from './infrastructure/database/postgres/postgres.client.js';
import { createMongo, type Mongo } from './infrastructure/database/mongo/mongo.client.js';
import { Outbox, OutboxRelay } from './core/events/outbox.js';
import { PostgresEventStore } from './core/events/event-store.js';
import { ProcessedEventsLedger } from './core/events/ledger.js';
import { SubjectRegistry } from './core/events/subject.js';
import { EventSystem } from './core/events/system.js';
import { DomainEventFactory } from './core/events/domain-event.factory.js';
import { CommandBus } from './core/commands/command-bus.js';
import { logCommands } from './infrastructure/command-bus/logging.middleware.js';
import { createCommandHandlers } from './infrastructure/command-bus/register-handlers.js';
import { EventTransportFactory } from './infrastructure/event-bus/event-transport.factory.js';
import { ProviderFactory, type Providers } from './infrastructure/providers.factory.js';
import { AccountRepository, AccountService } from './modules/account/index.js';
import { AuthService, TokenService, UsersRepository } from './modules/auth/index.js';
import { AuthoringService } from './modules/authoring/index.js';
import { CatalogRepository, CatalogService, FoodRepository, IngredientSearchService } from './modules/catalog/index.js';
import { ChefRepository, ChefService, InsightsService } from './modules/chef/index.js';
import { CommunityService } from './modules/community/index.js';
import { CookingRepository, CookingService, KitchenService } from './modules/cooking/index.js';
import { DaysService, HomeService, MealsRepository, NudgesRepository, NudgesService } from './modules/home/index.js';
import { MediaRepository, MediaService } from './modules/media/index.js';
import { MenusRepository, MenusService } from './modules/menus/index.js';
import { OnboardingService, PreferencesRepository, PreferencesService } from './modules/onboarding/index.js';
import { PantryRepository, PantryService, PantrySetupService } from './modules/pantry/index.js';
import { ProfileService } from './modules/profile/index.js';
import { ReceiptsRepository, ReceiptsService } from './modules/receipts/index.js';
import { NutritionService, GeneratedRecipesService, RecipeLibraryRepository, RecipeLibraryService, RecipePhotosService, RecipesRepository, RecipesService, RecommendationsService } from './modules/recipes/index.js';
import { ShoppingRepository, ShoppingService } from './modules/shopping/index.js';

export type { Providers };

/**
 * Raíz de composición: aquí se crean y se conectan todas las dependencias de los módulos.
 * Cada módulo expone su API en `modules/<módulo>/index.ts`; las capas no se instancian entre sí,
 * reciben lo que necesitan por constructor.
 */
export async function createContainer(env: Env, log: FastifyBaseLogger, overrides: Partial<Providers> = {}) {
  const pg: Postgres = createPostgres(env.DATABASE_URL);
  const mongo: Mongo = await createMongo(env.MONGO_URL, env.MONGO_DB, env.MONGO_FOOD_DB);
  const db = pg.db;

  // Eventos: Factory → Event Store + Outbox → Relay → Transporte (RabbitMQ) → Subjects → Observers.
  const eventFactory = new DomainEventFactory();
  const eventStore = new PostgresEventStore(db, eventFactory);
  const outbox = new Outbox(db, eventStore, eventFactory);
  const subjects = new SubjectRegistry(new ProcessedEventsLedger(db), log, undefined, () => catalog.sync());
  const transport = await new EventTransportFactory(env, log).create({ subjects, factory: eventFactory });
  const relay = new OutboxRelay(db, eventFactory, transport.dispatcher, log, { maxAttempts: env.OUTBOX_MAX_ATTEMPTS });
  const events = new EventSystem(db, eventFactory, eventStore, outbox, relay, subjects, transport, log);

  const providers: Providers = new ProviderFactory(env, log).createAll(overrides);

  const repos = {
    users: new UsersRepository(db),
    account: new AccountRepository(db, mongo.c),
    preferences: new PreferencesRepository(db),
    catalog: new CatalogRepository(db),
    foods: new FoodRepository(mongo.foods),
    recipes: new RecipesRepository(db),
    media: new MediaRepository(db),
    pantry: new PantryRepository(db),
    receipts: new ReceiptsRepository(db, mongo.c),
    shopping: new ShoppingRepository(db),
    menus: new MenusRepository(db),
    meals: new MealsRepository(db),
    nudges: new NudgesRepository(db),
    chef: new ChefRepository(mongo.c),
    cooking: new CookingRepository(db, mongo.c),
  };

  // catalog
  const catalog = await new CatalogService(repos.catalog, repos.foods).ready();
  // No bloquea el arranque, pero sin este catálogo el buscador se queda solo con los ingredientes base.
  void repos.foods
    .isEmpty()
    .then((empty) => empty && log.warn(`products_slim está vacía o no existe en la base «${env.MONGO_FOOD_DB}» (MONGO_FOOD_DB)`))
    .catch((err: unknown) => log.warn({ err }, 'no se pudo leer products_slim'));
  // auth
  const tokens = new TokenService(env.JWT_SECRET, env.ACCESS_TOKEN_TTL_SECONDS, env.REFRESH_TOKEN_TTL_DAYS, repos.users);
  const auth = new AuthService(db, repos.users, tokens, providers.oauth, outbox);
  // onboarding
  const preferences = new PreferencesService(db, repos.preferences, repos.users, catalog, outbox);
  const onboarding = new OnboardingService(db, repos.preferences, repos.users, repos.menus, preferences, outbox);
  const ingredientSearch = new IngredientSearchService(catalog, repos.foods, preferences, log);
  // media
  const media = new MediaService(repos.media, providers.storage);
  // recipes
  const recipes = new RecipesService(db, repos.recipes, repos.pantry, repos.shopping, repos.chef, catalog, preferences, repos.users, outbox, env.SHARE_BASE_URL);
  const recipePhotos = new RecipePhotosService(repos.recipes, catalog, env.PUBLIC_BASE_URL);
  const recipeLibrary = new RecipeLibraryService(db, new RecipeLibraryRepository(mongo.rawRecipes), repos.recipes, catalog, recipePhotos, log);
  const generatedRecipes = new GeneratedRecipesService(db, repos.recipes, catalog, preferences, recipePhotos, log);
  const recommendations = new RecommendationsService(repos.recipes, recipes, repos.cooking, repos.chef, log, recipeLibrary);
  const nutrition = new NutritionService(repos.recipes, catalog, providers.nutritionEstimator);
  // pantry, receipts, shopping, menus
  const pantry = new PantryService(db, repos.pantry, catalog, recommendations, outbox);
  const receipts = new ReceiptsService(db, repos.receipts, providers.storage, providers.receiptParser, catalog, pantry, outbox);
  const shopping = new ShoppingService(db, repos.shopping, catalog, recipes, pantry, preferences, repos.chef, outbox, env.SHARE_BASE_URL);
  const pantrySetup = new PantrySetupService(db, repos.pantry, repos.recipes, recipes, recommendations, shopping, catalog, outbox);
  const menus = new MenusService(db, repos.menus, recommendations, recipes, outbox);
  // home
  const days = new DaysService(db, repos.meals, preferences, recipes, outbox);
  const nudges = new NudgesService(db, repos.nudges, repos.pantry, recommendations, outbox);
  // chef
  const insights = new InsightsService(repos.chef, outbox);
  const chef = new ChefService(repos.chef, repos.recipes, repos.shopping, repos.users, recipes, recommendations, insights, preferences, catalog, providers.chefEngine, generatedRecipes, outbox);
  // cooking
  const cooking = new CookingService(db, repos.cooking, repos.recipes, repos.media, recipes, pantry, days, outbox);
  const kitchen = new KitchenService(repos.cooking, repos.recipes, catalog, providers.storage);
  // community, authoring
  const community = new CommunityService(db, repos.recipes, repos.users, recipes, catalog, providers.moderation, outbox);
  const authoring = new AuthoringService(db, repos.recipes, repos.media, recipes, catalog, providers.storage, providers.moderation, outbox, env.SHARE_BASE_URL);
  // profile, account, home
  const profile = new ProfileService(repos.users, repos.cooking, repos.recipes, preferences, insights);
  const account = new AccountService(db, repos.account, repos.users, repos.media, providers.mailer, providers.storage, outbox, eventStore);
  const home = new HomeService(repos.users, repos.cooking, days, recommendations, nudges, chef, cooking, providers.storage);

  const services = {
    catalog,
    ingredientSearch,
    tokens,
    auth,
    account,
    preferences,
    onboarding,
    media,
    recipes,
    recommendations,
    recipeLibrary,
    recipePhotos,
    generatedRecipes,
    nutrition,
    pantry,
    pantrySetup,
    receipts,
    shopping,
    menus,
    days,
    nudges,
    home,
    insights,
    chef,
    cooking,
    kitchen,
    community,
    authoring,
    profile,
  };

  // Comandos: HTTP → CommandBus → handler del módulo → servicio.
  const commands = new CommandBus(createCommandHandlers(services), [logCommands(log)]);

  return {
    env,
    log,
    pg,
    mongo,
    commands,
    events,
    outbox,
    providers,
    repos,
    services,
    async close() {
      await events.close().catch((err) => log.warn({ err }, 'cerrando eventos'));
      await Promise.allSettled([pg.close(), mongo.close()]);
    },
  };
}

export type Container = Awaited<ReturnType<typeof createContainer>>;
