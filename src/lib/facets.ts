export type AnalysisFacets = {
  restaurant?: {
    cuisine: string[];
    budget: string | null;
    occasion: string[];
    features: string[];
  };
  recipe?: {
    nutritionGoals: string[];
    foodStyles: string[];
    mealType: string | null;
    dietaryTags: string[];
    estimatedTimeMinutes: number | null;
  };
  fitness?: {
    goals: string[];
    muscleGroups: string[];
    equipment: string[];
    difficulty: string | null;
    trainingStyles: string[];
  };
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function supportedTags(tags: string[], supported: string[]): string[] {
  return tags.filter((tag) => supported.includes(tag));
}

export function deriveFacets(category: string, entities: Record<string, unknown>, tags: string[]): AnalysisFacets {
  if (category === "restaurant") {
    return {
      restaurant: {
        cuisine: strings(entities.cuisine),
        budget: typeof entities.estimated_budget === "string" ? entities.estimated_budget : null,
        occasion: strings(entities.occasion),
        features: strings(entities.features),
      },
    };
  }
  if (category === "recipe") {
    return {
      recipe: {
        nutritionGoals: supportedTags(tags, ["bulking", "cutting", "maintenance", "high-protein"]),
        foodStyles: supportedTags(tags, ["gym", "gourmet", "meal-prep", "everyday", "comfort-food"]),
        mealType: typeof entities.meal_type === "string" ? entities.meal_type : null,
        dietaryTags: strings(entities.dietary_tags),
        estimatedTimeMinutes: typeof entities.estimated_time_minutes === "number"
          ? entities.estimated_time_minutes
          : null,
      },
    };
  }
  if (category === "fitness") {
    return {
      fitness: {
        goals: supportedTags(tags, ["strength", "hypertrophy", "mobility", "conditioning", "fat-loss", "rehab"]),
        muscleGroups: strings(entities.muscle_groups),
        equipment: strings(entities.equipment),
        difficulty: typeof entities.difficulty === "string" ? entities.difficulty : null,
        trainingStyles: supportedTags(tags, ["bodybuilding", "powerlifting", "calisthenics", "crossfit", "running", "hiit"]),
      },
    };
  }
  return {};
}
