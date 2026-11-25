/** Moderación automática de contenido publicado (recetas, comentarios). */
export interface Moderation {
  review(input: { text: string; imageKeys: string[] }): Promise<{ approved: boolean; reason?: string }>;
}

const BLOCKED = [/\bhttps?:\/\//i, /\bcompra ya\b/i, /\bviagra\b/i];

export class BasicModeration implements Moderation {
  async review(input: { text: string }) {
    const hit = BLOCKED.find((re) => re.test(input.text));
    return hit ? { approved: false, reason: 'El texto parece spam o publicidad.' } : { approved: true };
  }
}
