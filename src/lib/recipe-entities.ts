type Entity = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function record(value: unknown): Entity | null {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Entity : null;
}

export type RecipeIngredient = { name: string; quantity: string; unit: string; optional: boolean; section: string; notes: string; source: string };

export function nestedRecipes(entities: Record<string, unknown>): Array<Record<string, unknown>> {
  const recipes = Array.isArray(entities.recipes) ? entities.recipes.map(record).filter((item): item is Entity => Boolean(item)) : [];
  const single = record(entities.recipe);
  return [...recipes, ...(single ? [single] : [])];
}

// Accept the source formats already stored by earlier analysis versions. Keep
// free-form quantities intact rather than guessing a structured amount/unit.
export function recipeIngredients(value: unknown, section = ""): RecipeIngredient[] {
  const object = record(value);
  if (object && Array.isArray(object.items)) return recipeIngredients(object.items, text(object.section) || section);
  if (object && !("name" in object) && !("items" in object)) return Object.entries(object).flatMap(([group, items]) => recipeIngredients(items, group));
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const ingredient = record(entry);
    if (ingredient && Array.isArray(ingredient.items)) return recipeIngredients(ingredient.items, text(ingredient.section) || section);
    const name = ingredient ? text(ingredient.name) : text(entry);
    if (!name) return [];
    const components = ingredient && Array.isArray(ingredient.components) ? ingredient.components.map(text).filter(Boolean).join(", ") : "";
    return [{ name, quantity: text(ingredient?.quantity), unit: text(ingredient?.unit), optional: ingredient?.optional === true, section: text(ingredient?.section) || text(ingredient?.component) || section,
      notes: ingredient ? [ingredient.note, ingredient.preparation, ingredient.usage, ingredient.alternative, components].map(text).filter(Boolean).join(" · ") : "", source: text(ingredient?.source) }];
  });
}

export function recipeSteps(value: unknown): Array<{ position: number; instruction: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const step = record(entry);
    const instruction = step ? text(step.instruction) : text(entry);
    if (!instruction) return [];
    const position = Number(step?.position);
    return [{ position: Number.isFinite(position) && position > 0 ? position : index + 1, instruction }];
  }).sort((a, b) => a.position - b.position);
}
