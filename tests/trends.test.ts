import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildPlatformTrends,
	dueAt,
	weekEnds,
} from "../src/app/module/admin/admin.trends";
import { buildCycleTrends } from "../src/app/module/cycle/cycle.trends";

const at = (iso: string) => new Date(iso);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const bill = {
	createdAt: at("2026-09-01T03:00:00Z"),
	totalPayable: 11678.98,
	creditAmount: 4450,
	payments: [
		{ amount: 2000, paidAt: at("2026-09-02T13:50:00Z") },
		{ amount: 5228.98, paidAt: null },
	],
};

test("week ends run oldest first and finish at now", () => {
	const points = weekEnds(at("2026-09-30T12:00:00Z"), 3);

	assert.deepEqual(
		points.map((point) => point.toISOString()),
		[
			"2026-09-16T12:00:00.000Z",
			"2026-09-23T12:00:00.000Z",
			"2026-09-30T12:00:00.000Z",
		],
	);
});

test("a bill owes nothing before it exists, and only paid payments count", () => {
	assert.equal(dueAt(bill, at("2026-08-31T00:00:00Z")), 0);
	assert.equal(dueAt(bill, at("2026-09-01T12:00:00Z")), 722898);
	assert.equal(dueAt(bill, at("2026-09-03T00:00:00Z")), 522898);
});

test("a bill in credit owes zero, not a negative amount", () => {
	const credit = { ...bill, creditAmount: 12000, payments: [] };

	assert.equal(dueAt(credit, at("2026-09-05T00:00:00Z")), 0);
});

test("platform trends count what existed at each point", () => {
	const trends = buildPlatformTrends(
		{
			users: [at("2026-09-01T00:00:00Z"), at("2026-09-10T00:00:00Z")],
			messes: [at("2026-09-05T00:00:00Z")],
			cycles: [
				{
					createdAt: at("2026-08-01T00:00:00Z"),
					closedAt: at("2026-09-01T03:00:00Z"),
				},
				{ createdAt: at("2026-09-01T03:00:00Z"), closedAt: null },
			],
			bills: [bill],
		},
		[
			at("2026-08-20T00:00:00Z"),
			at("2026-09-02T00:00:00Z"),
			at("2026-09-12T00:00:00Z"),
		],
	);

	assert.deepEqual(trends.users, [0, 1, 2]);
	assert.deepEqual(trends.messes, [0, 0, 1]);
	assert.deepEqual(trends.openCycles, [1, 1, 1]);
	assert.deepEqual(trends.outstandingDue, [0, 7228.98, 5228.98]);
});

test("cycle trends give one value per day, split by expense type", () => {
	const trends = buildCycleTrends({
		from: day("2026-09-01"),
		to: day("2026-09-03"),
		meals: [
			{ date: day("2026-09-01"), lunch: 1, dinner: 1, memberId: "me" },
			{ date: day("2026-09-01"), lunch: 0.5, dinner: 1, memberId: "you" },
			{ date: day("2026-09-03"), lunch: 1, dinner: 0, memberId: "me" },
		],
		expenses: [
			{ spentAt: day("2026-09-01"), type: "GROCERY", amount: 1450.5 },
			{ spentAt: day("2026-09-02"), type: "GAS", amount: 1200 },
			{ spentAt: day("2026-09-02"), type: "RENT", amount: 24000 },
			// 00:30 on the 3rd in Dhaka is still the 2nd in UTC.
			{ spentAt: at("2026-09-02T18:30:00Z"), type: "GROCERY", amount: 100 },
		],
		memberId: "me",
		previousBills: null,
	});

	assert.deepEqual(trends.days, ["2026-09-01", "2026-09-02", "2026-09-03"]);
	assert.deepEqual(trends.meals, [3.5, 0, 1]);
	assert.deepEqual(trends.grocery, [1450.5, 0, 100]);
	assert.deepEqual(trends.shared, [0, 1200, 0]);
	assert.deepEqual(trends.myMeals, [2, 0, 1]);
	assert.equal(trends.previousDue, null);
});

test("the previous month's due is read at the close of each Dhaka day", () => {
	const trends = buildCycleTrends({
		from: day("2026-09-01"),
		to: day("2026-09-02"),
		meals: [],
		expenses: [],
		memberId: null,
		previousBills: [bill],
	});

	assert.deepEqual(trends.previousDue, [7228.98, 5228.98]);
	assert.equal(trends.myMeals, null);
});
