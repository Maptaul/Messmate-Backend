import assert from "node:assert/strict";
import { test } from "node:test";

import { MealValidation } from "../src/app/module/meal/meal.validation";
import { MealPlanValidation } from "../src/app/module/mealPlan/mealPlan.validation";

const parseMeal = (lunch: unknown) =>
	MealValidation.UpdateMealValidationZodSchema.safeParse({ lunch });

const parsePlan = (lunch: unknown) =>
	MealPlanValidation.SetMealPlanValidationZodSchema.safeParse({
		cycleId: "cycle-1",
		days: [{ date: "2026-08-16", lunch, dinner: 0 }],
	});

test("accepts whole and half meals", () => {
	for (const lunch of [0, 0.5, 1, 1.5, 2, 2.5, 10]) {
		assert.equal(parseMeal(lunch).success, true, `lunch=${lunch}`);
		assert.equal(parsePlan(lunch).success, true, `plan lunch=${lunch}`);
	}
});

test("rejects fractions smaller than a half meal", () => {
	for (const lunch of [0.25, 0.3, 1.1, 1.75]) {
		assert.equal(parseMeal(lunch).success, false, `lunch=${lunch}`);
		assert.equal(parsePlan(lunch).success, false, `plan lunch=${lunch}`);
	}
});

test("still rejects negatives and counts above ten", () => {
	assert.equal(parseMeal(-0.5).success, false);
	assert.equal(parseMeal(10.5).success, false);
});

test("accepts the half meal the August register actually recorded", () => {
	const parsed = parseMeal(0.5);

	assert.equal(parsed.success, true);
	assert.equal(parsed.data?.lunch, 0.5);
});

test("half meals survive as numbers, not strings", () => {
	const parsed = parseMeal("1.5");

	assert.equal(parsed.success, true);
	assert.equal(parsed.data?.lunch, 1.5);
});
