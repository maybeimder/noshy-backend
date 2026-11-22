import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { CompleteBody, DraftBody, NutritionPreviewBody } from './onboarding.dto.js';
import type { OnboardingStep } from '../../../core/domain/catalog.js';

export class OnboardingController {
  constructor(private readonly c: Container) {}

  options = async () => ok(this.c.services.catalog.onboardingOptions());

  preview = async (req: Req<{ Body: z.infer<typeof NutritionPreviewBody> }>) => ok(this.c.services.onboarding.preview(req.body));

  state = async (req: Req) => ok(await this.c.services.onboarding.state(req.user.id));

  saveDraft = async (req: Req<{ Body: z.infer<typeof DraftBody> }>) =>
    ok(await this.c.services.onboarding.saveDraft(req.user.id, { currentStep: req.body.currentStep, draft: req.body.draft, skippedSteps: req.body.skippedSteps as OnboardingStep[] | undefined }));

  complete = async (req: Req<{ Body: z.infer<typeof CompleteBody> }>) => ok(await this.c.services.onboarding.complete(req.user.id, req.tz, req.body));
}
