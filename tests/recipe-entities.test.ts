import { expect, test } from "bun:test";
import { nestedRecipes, recipeIngredients, recipeSteps } from "../src/lib/recipe-entities";

test("legacy recipe text remains visible without invented quantities or steps", () => {
  expect(recipeIngredients(["400 g de pollo", "laurel"])).toEqual([
    { name: "400 g de pollo", quantity: "", unit: "", optional: false, section: "", notes: "", source: "" },
    { name: "laurel", quantity: "", unit: "", optional: false, section: "", notes: "", source: "" },
  ]);
  expect(recipeSteps(["Cortar el pollo", "Cocinar hasta que esté hecho"])).toEqual([
    { position: 1, instruction: "Cortar el pollo" }, { position: 2, instruction: "Cocinar hasta que esté hecho" },
  ]);
});

test("section dictionaries and nested recipe containers retain group and source labels", () => {
  expect(recipeIngredients({ Dough: ["flour", { name: "water", source: "recipe card" }], Filling: ["apple"] })).toEqual([
    { name: "flour", quantity: "", unit: "", optional: false, section: "Dough", notes: "", source: "" },
    { name: "water", quantity: "", unit: "", optional: false, section: "Dough", notes: "", source: "recipe card" },
    { name: "apple", quantity: "", unit: "", optional: false, section: "Filling", notes: "", source: "" },
  ]);
  const recipes = nestedRecipes({ recipes: [{ name: "First", ingredients: ["x"], steps: ["mix"] }], recipe: { ingredients: ["y"], steps: ["bake"] } });
  expect(recipes).toHaveLength(2);
  expect(recipeIngredients(recipes[0].ingredients).map(item => item.name)).toEqual(["x"]);
  expect(recipeSteps(recipes[1].steps).map(step => step.instruction)).toEqual(["bake"]);
});

test("structured, encoded and grouped recipe data retain source details without mutation", () => {
  const source = [{ section: "Salsa", items: ["sal al gusto", { name: "tomate", quantity: 2, unit: "unidades", optional: true, preparation: "picado" }] }, JSON.stringify({ name: "aceite", quantity: "un chorrito" }), { name: "crema", components: ["leche", "canela"] }];
  const original = JSON.stringify(source);
  const ingredients = recipeIngredients(source);
  expect(ingredients.map(i => i.name)).toEqual(["sal al gusto", "tomate", "aceite", "crema"]);
  expect(ingredients[1]).toMatchObject({ quantity: "2", unit: "unidades", optional: true, section: "Salsa", notes: "picado" });
  expect(ingredients[2].quantity).toBe("un chorrito");
  expect(ingredients[3].notes).toBe("leche, canela");
  expect(JSON.stringify(source)).toBe(original);
  expect(recipeSteps([{ instruction: "Servir", position: 2 }, JSON.stringify({ instruction: "Mezclar", position: 1 })])).toEqual([{ position: 1, instruction: "Mezclar" }, { position: 2, instruction: "Servir" }]);
});

test("missing and malformed recipe data do not fabricate ingredients", () => {
  expect(recipeIngredients(null)).toEqual([]);
  expect(recipeIngredients([null, {}, { name: "" }, []])).toEqual([]);
  expect(recipeSteps([null, {}, { instruction: "" }, []])).toEqual([]);
});
