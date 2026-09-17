import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultMealsFor } from "../src/app/module/mealPlan/mealPlan.service";

const day = new Date("2026-09-18T00:00:00.000Z");

const member = (id: string, overrides: Record<string, unknown> = {}) => ({
	id,
	name: id,
	joinedAt: new Date("2026-09-01T08:30:00.000Z"),
	leftAt: null,
	defaultLunch: 1,
	defaultDinner: 1,
	...overrides,
});

test("a member who set no plan eats their default", () => {
	const [row] = defaultMealsFor(day, new Set(), [member("tarak")]);

	assert.deepEqual(row, {
		memberId: "tarak",
		name: "tarak",
		lunch: 1,
		dinner: 1,
		isDefault: true,
	});
});

test("any declared plan wins, including a day switched off with 0/0", () => {
	const rows = defaultMealsFor(day, new Set(["tarak"]), [
		member("tarak"),
		member("jihan"),
	]);

	assert.deepEqual(
		rows.map((row) => row.memberId),
		["jihan"],
	);
});

test("a member with no default is not counted", () => {
	const rows = defaultMealsFor(day, new Set(), [
		member("samir", { defaultLunch: 0, defaultDinner: 0 }),
	]);

	assert.equal(rows.length, 0);
});

test("half defaults and dinner-only defaults are kept as they are", () => {
	const rows = defaultMealsFor(day, new Set(), [
		member("arman", { defaultLunch: 0.5, defaultDinner: 0 }),
		member("parvez", { defaultLunch: 0, defaultDinner: 1 }),
	]);

	assert.deepEqual(
		rows.map((row) => [row.memberId, row.lunch, row.dinner]),
		[
			["arman", 0.5, 0],
			["parvez", 0, 1],
		],
	);
});

test("no default before a member joined or after they left", () => {
	const rows = defaultMealsFor(day, new Set(), [
		member("late", { joinedAt: new Date("2026-09-19T04:00:00.000Z") }),
		member("gone", { leftAt: new Date("2026-09-17T12:00:00.000Z") }),
	]);

	assert.equal(rows.length, 0);
});

test("the day a member joins or leaves still counts, whatever the hour", () => {
	const rows = defaultMealsFor(day, new Set(), [
		member("joins", { joinedAt: new Date("2026-09-18T15:45:00.000Z") }),
		member("leaves", { leftAt: new Date("2026-09-18T02:00:00.000Z") }),
	]);

	assert.deepEqual(
		rows.map((row) => row.memberId),
		["joins", "leaves"],
	);
});
