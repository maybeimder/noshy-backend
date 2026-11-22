import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './config/env.js';
import { LocalStorage, type Storage } from './storage/storage.js';
import { MockReceiptParser, NoneReceiptParser, type ReceiptParser } from '../modules/receipts/receipts.providers.js';
import { BasicModeration, type Moderation } from '../modules/community/community.providers.js';
import { JwksOAuthVerifier, type OAuthVerifier } from '../modules/auth/auth.providers.js';
import { LogNotifier, type Notifier } from '../modules/notifications/notifications.providers.js';
import { LlmChefEngine, RuleBasedChefEngine, type ChefEngine } from '../modules/chef/chef.providers.js';
import { DEFAULT_OPENROUTER_MODELS, OpenRouterClient } from './ai/openrouter.client.js';
import { LogMailer, type Mailer } from '../modules/account/account.providers.js';
import { RuleBasedNutritionEstimator, type NutritionEstimator } from '../modules/recipes/recipes.providers.js';

export type Providers = {
  storage: Storage;
  receiptParser: ReceiptParser;
  moderation: Moderation;
  oauth: OAuthVerifier;
  notifier: Notifier;
  chefEngine: ChefEngine;
  mailer: Mailer;
  nutritionEstimator: NutritionEstimator;
};

/**
 * GoF Factory de los servicios externos. Cada método decide la implementación según el entorno;
 * los servicios solo ven la interfaz. Los tests reemplazan cualquiera con `overrides`.
 */
export class ProviderFactory {
  constructor(
    private readonly env: Env,
    private readonly log: FastifyBaseLogger,
  ) {}

  createAll(overrides: Partial<Providers> = {}): Providers {
    return {
      storage: overrides.storage ?? this.storage(),
      receiptParser: overrides.receiptParser ?? this.receiptParser(),
      moderation: overrides.moderation ?? this.moderation(),
      oauth: overrides.oauth ?? this.oauth(),
      notifier: overrides.notifier ?? this.notifier(),
      chefEngine: overrides.chefEngine ?? this.chefEngine(),
      mailer: overrides.mailer ?? this.mailer(),
      nutritionEstimator: overrides.nutritionEstimator ?? this.nutritionEstimator(),
    };
  }

  storage(): Storage {
    switch (this.env.STORAGE_DRIVER) {
      case 'local':
        return new LocalStorage(this.env.STORAGE_DIR, `${this.env.PUBLIC_BASE_URL}/api/v1`, this.env.UPLOAD_SIGNING_SECRET);
    }
  }

  receiptParser(): ReceiptParser {
    return this.env.RECEIPT_PARSER === 'mock' ? new MockReceiptParser() : new NoneReceiptParser();
  }

  moderation(): Moderation {
    return new BasicModeration();
  }

  oauth(): OAuthVerifier {
    return new JwksOAuthVerifier({ google: this.env.GOOGLE_CLIENT_IDS, apple: this.env.APPLE_CLIENT_IDS });
  }

  notifier(): Notifier {
    return new LogNotifier(this.log);
  }

  mailer(): Mailer {
    return new LogMailer(this.log);
  }

  nutritionEstimator(): NutritionEstimator {
    return new RuleBasedNutritionEstimator();
  }

  /** `openrouter` si hay API key (o `CHEF_ENGINE=openrouter`); el LLM siempre cae al motor de reglas si falla. */
  chefEngine(): ChefEngine {
    const rules = new RuleBasedChefEngine();
    const { CHEF_ENGINE, OPENROUTER_API_KEY, OPENROUTER_MODEL } = this.env;
    const wantsLlm = CHEF_ENGINE === 'openrouter' || (CHEF_ENGINE === undefined && !!OPENROUTER_API_KEY);
    if (!wantsLlm) return rules;
    if (!OPENROUTER_API_KEY) {
      this.log.warn('CHEF_ENGINE=openrouter sin OPENROUTER_API_KEY: uso el motor de reglas');
      return rules;
    }
    const models = OPENROUTER_MODEL.length ? OPENROUTER_MODEL : DEFAULT_OPENROUTER_MODELS;
    return new LlmChefEngine(new OpenRouterClient(OPENROUTER_API_KEY, models, this.log), rules, this.log);
  }
}
