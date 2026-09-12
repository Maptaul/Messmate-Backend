import assert from "node:assert/strict";
import { test } from "node:test";

import {
	computeSettlement,
	type SettlementInput,
} from "../src/app/module/cycle/cycle.settlement";

const MONTHLY_DEPOSIT = 600;

const ledger = [
	{ name: "samir", meals: 59, bazaar: 1200 },
	{ name: "ahir", meals: 40, bazaar: 1000 },
	{ name: "arman", meals: 17.5, bazaar: 1015 },
	{ name: "parvez", meals: 28, bazaar: 1170 },
	{ name: "rafi", meals: 48, bazaar: 1850 },
	{ name: "shuvo", meals: 18, bazaar: 872 },
	{ name: "tarak", meals: 33, bazaar: 630 },
	{ name: "jihan", meals: 39, bazaar: 1248 },
];

const personalBazaar = ledger.reduce((sum, m) => sum + m.bazaar, 0);
const fundBazaar = ledger.length * MONTHLY_DEPOSIT;

const august: SettlementInput = {
	monthlyRent: 0,
	monthlyDeposit: 0,
	daysInMonth: 31,
	members: ledger.map((m) => ({
		memberId: m.name,
		mealCount: m.meals,
		depositTotal: MONTHLY_DEPOSIT,
		paidExpenseTotal: m.bazaar,
		openingBalance: 0,
		daysPresent: 31,
	})),
	expenses: [
		...ledger.map((m) => ({
			type: "GROCERY" as const,
			amount: m.bazaar,
			splitMethod: "BY_MEAL" as const,
		})),
		{ type: "GROCERY" as const, amount: fundBazaar, splitMethod: "BY_MEAL" as const },
	],
};

const result = computeSettlement(august);
const billOf = (name: string) => result.bills.find((b) => b.memberId === name)!;
const sumOf = (pick: (b: (typeof result.bills)[number]) => number) =>
	Number(result.bills.reduce((sum, b) => sum + pick(b), 0).toFixed(2));

test("the ledger's own totals are what we are feeding in", () => {
	assert.equal(personalBazaar, 8985);
	assert.equal(fundBazaar, 4800);
	assert.equal(personalBazaar + fundBazaar, 13785);
});

test("reproduces the 282.5 meals the register counted", () => {
	assert.equal(result.totalMeals, 282.5);
});

test("counts deposit-funded groceries into the grocery total", () => {
	assert.equal(result.totalGrocery, 13785);
});

test("reproduces the rate the mess worked out by hand", () => {
	assert.equal(result.mealRate, 48.7965);
	assert.ok(Math.abs(result.mealRate - 48.79646) < 0.0001);
});

test("gets the rate wrong if the fund's shopping is left out", () => {
	const withoutFund = computeSettlement({
		...august,
		expenses: august.expenses.slice(0, ledger.length),
	});

	assert.equal(withoutFund.mealRate, 31.8053);
});

test("meal costs add back up to every taka spent on food", () => {
	assert.equal(sumOf((b) => b.mealCost), 13785);
});

test("the month settles to zero: what was paid in is what was spent", () => {
	assert.equal(sumOf((b) => b.creditAmount), 13785);
	assert.equal(sumOf((b) => b.totalPayable), 13785);
	assert.equal(sumOf((b) => b.dueAmount), 0);
});

test("carries a member's half meal through to his bill", () => {
	const arman = billOf("arman");

	assert.equal(arman.mealCount, 17.5);
	assert.ok(Math.abs(arman.mealCost - 17.5 * result.mealRate) < 0.01);
});

test("whoever shopped most is owed, whoever shopped least owes", () => {
	assert.ok(billOf("rafi").dueAmount < 0);
	assert.ok(billOf("tarak").dueAmount > 0);
});
