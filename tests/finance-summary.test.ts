import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildSummary,
	periodRange,
	type TSummaryRow,
} from "../src/app/module/finance/finance.summary";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

const range = (period: Parameters<typeof periodRange>[0], anchor: string) => {
	const { from, to } = periodRange(period, day(anchor));

	return [iso(from), iso(to)];
};

test("a week starts on Saturday, and a Saturday starts its own week", () => {
	assert.deepEqual(range("weekly", "2026-09-19"), ["2026-09-19", "2026-09-25"]);
});

test("a Friday belongs to the week that began the Saturday before", () => {
	assert.deepEqual(range("weekly", "2026-09-18"), ["2026-09-12", "2026-09-18"]);
});

test("a week can straddle a month and a year", () => {
	assert.deepEqual(range("weekly", "2026-01-01"), ["2025-12-27", "2026-01-02"]);
});

test("daily, monthly and yearly cover exactly their own span", () => {
	assert.deepEqual(range("daily", "2026-09-18"), ["2026-09-18", "2026-09-18"]);
	assert.deepEqual(range("monthly", "2026-09-18"), [
		"2026-09-01",
		"2026-09-30",
	]);
	assert.deepEqual(range("monthly", "2028-02-10"), [
		"2028-02-01",
		"2028-02-29",
	]);
	assert.deepEqual(range("yearly", "2026-09-18"), ["2026-01-01", "2026-12-31"]);
});

const row = (
	date: string,
	type: TSummaryRow["type"],
	category: TSummaryRow["category"],
	amount: number,
): TSummaryRow => ({ date: day(date), type, category, amount });

test("totals, balance and categories for a week", () => {
	const summary = buildSummary(
		"weekly",
		periodRange("weekly", day("2026-09-18")),
		[
			row("2026-09-12", "INCOME", "TUITION", 5000),
			row("2026-09-13", "EXPENSE", "FOOD", 120.5),
			row("2026-09-13", "EXPENSE", "TRANSPORT", 60),
			row("2026-09-18", "EXPENSE", "FOOD", 250),
		],
	);

	assert.equal(summary.income, 5000);
	assert.equal(summary.expense, 430.5);
	assert.equal(summary.balance, 4569.5);
	assert.deepEqual(summary.byCategory.expense, [
		{ category: "FOOD", total: 370.5 },
		{ category: "TRANSPORT", total: 60 },
	]);
	assert.equal(summary.breakdown.length, 7);
	assert.deepEqual(summary.breakdown[1], {
		label: "2026-09-13",
		from: "2026-09-13",
		to: "2026-09-13",
		income: 0,
		expense: 180.5,
		balance: -180.5,
	});
	assert.equal(
		summary.breakdown[3]?.expense,
		0,
		"an empty day is 0, not missing",
	);
});

test("small amounts add up in paisa, not floating point", () => {
	const summary = buildSummary(
		"daily",
		periodRange("daily", day("2026-09-18")),
		[
			row("2026-09-18", "EXPENSE", "FOOD", 0.1),
			row("2026-09-18", "EXPENSE", "FOOD", 0.2),
		],
	);

	assert.equal(summary.expense, 0.3);
	assert.equal(summary.balance, -0.3);
	assert.deepEqual(summary.breakdown, []);
});

test("a month has one bucket per day, a leap February included", () => {
	const summary = buildSummary(
		"monthly",
		periodRange("monthly", day("2028-02-10")),
		[],
	);

	assert.equal(summary.breakdown.length, 29);
	assert.equal(summary.breakdown[28]?.label, "2028-02-29");
});

test("a year has twelve monthly buckets that catch their own days", () => {
	const summary = buildSummary(
		"yearly",
		periodRange("yearly", day("2026-09-18")),
		[
			row("2026-01-31", "INCOME", "SALARY", 1000),
			row("2026-02-01", "EXPENSE", "MESS", 3425),
			row("2026-12-31", "EXPENSE", "HEALTH", 200),
		],
	);

	assert.equal(summary.breakdown.length, 12);
	assert.equal(summary.breakdown[0]?.label, "2026-01");
	assert.equal(summary.breakdown[0]?.income, 1000);
	assert.equal(summary.breakdown[1]?.expense, 3425);
	assert.equal(summary.breakdown[11]?.expense, 200);
	assert.equal(summary.balance, -2625);
});
