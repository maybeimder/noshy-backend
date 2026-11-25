import type { z } from 'zod';
import type { Container } from '../../../container.js';
import type { Req } from '../../../core/shared/request.js';
import { ok } from '../../../core/shared/http.js';
import type { PreferencesPatchBody } from '../../onboarding/http/onboarding.dto.js';

export class ProfileController {
  constructor(private readonly c: Container) {}

  get = async (req: Req) => ok(await this.c.services.profile.get(req.user.id, req.tz));

  patchPreferences = async (req: Req<{ Body: z.infer<typeof PreferencesPatchBody> }>) => {
    await this.c.commands.execute('onboarding.patchPreferences', { userId: req.user.id, input: req.body });
    return ok(await this.c.services.profile.get(req.user.id, req.tz));
  };
}
