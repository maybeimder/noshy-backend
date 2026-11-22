import type { Quantity } from '../../core/domain/quantity.js';

/** Paso tal como lo recibe el front en modo cocina: escalado, adaptado y con `display`. */
export type CookingStepSnapshot = {
  index: number;
  title: string;
  durationSeconds: number;
  heat: { level: number; label: string };
  equipment: string | null;
  ingredients: { ingredientId: string | null; label: string; prep: string | null; quantity: Quantity; fromStepIndex?: number }[];
  subSteps: {
    index: number;
    shortLabel: string;
    text: string;
    timerSeconds: number | null;
    heatLevel: number;
    heatChange?: { from: number; to: number; message: string };
  }[];
  doneWhen: string | null;
};
