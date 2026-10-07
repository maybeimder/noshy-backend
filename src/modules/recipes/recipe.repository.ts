import type { Tx } from '../../core/persistence/unit-of-work';
import type { Recipe } from './recipe.model';

export interface RecipeRepository {
  listByUser(userId: string, tx?: Tx): Promise<Recipe[]>;
  findById(userId: string, recipeId: string, tx?: Tx): Promise<Recipe | null>;
  findPublicById(recipeId: string, tx?: Tx): Promise<Recipe | null>;
  listPublic(tx?: Tx): Promise<Recipe[]>;
  insert(recipe: Recipe, tx?: Tx): Promise<void>;
  update(recipe: Recipe, tx?: Tx): Promise<void>;
  delete(userId: string, recipeId: string, tx?: Tx): Promise<boolean>;
}

export class InMemoryRecipeRepository implements RecipeRepository {
  private readonly byUser = new Map<string, Recipe[]>();

  async listByUser(userId: string) {
    return this.byUser.get(userId) ?? [];
  }

  async findById(userId: string, recipeId: string) {
    return (this.byUser.get(userId) ?? []).find((entry) => entry.id === recipeId) ?? null;
  }

  async findPublicById(recipeId: string) {
    return this.all().find((entry) => entry.id === recipeId && entry.isPublic) ?? null;
  }

  async listPublic() {
    return this.all().filter((entry) => entry.isPublic);
  }

  async insert(recipe: Recipe) {
    const recipes = this.byUser.get(recipe.userId) ?? [];
    recipes.push(recipe);
    this.byUser.set(recipe.userId, recipes);
  }

  async update(recipe: Recipe) {
    const recipes = this.byUser.get(recipe.userId) ?? [];
    const index = recipes.findIndex((entry) => entry.id === recipe.id);
    if (index !== -1) recipes[index] = recipe;
  }

  async delete(userId: string, recipeId: string) {
    const recipes = this.byUser.get(userId) ?? [];
    const index = recipes.findIndex((entry) => entry.id === recipeId);
    if (index === -1) return false;
    recipes.splice(index, 1);
    return true;
  }

  private all() {
    return [...this.byUser.values()].flat();
  }
}
