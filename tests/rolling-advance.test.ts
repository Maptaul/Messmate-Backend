import assert from "node:assert/strict";
import { test } from "node:test";

import {
	computeSettlement,
	type SettlementInput,
	sharesTheMonth,
	uncarriedBill,
} from "../src/app/module/cycle/cycle.settlement";

const DEPOSIT = 600;

const month = (
	overrides: Partial<SettlementInput["members"][number]> & {
		grocery: number;
		meals: number;
	},
): SettlementInput => ({
	monthlyRent: 0,
	monthlyDeposit: DEPOSIT,
	daysInMonth: 31,
	members: [
		{
			memberId: "tarak",
			mealCount: overrides.meals,
			depositTotal: overrides.depositTotal ?? DEPOSIT,
			paidExpenseTotal: overrides.paidExpenseTotal ?? 0,
			openingBalance: overrides.openingBalance ?? 0,
			daysPresent: 31,
		},
	],
	expenses: [
		{ type: "GROCERY", amount: overrides.grocery, splitMethod: "BY_MEAL" },
	],
});

const billFrom = (input: SettlementInput) => computeSettlement(input).bills[0]!;

test("a month charges the coming month's deposit on top of what was eaten", () => {
	const bill = billFrom(month({ meals: 10, grocery: 1000 }));

	assert.equal(bill.mealCost, 1000);
	assert.equal(bill.advanceCharged, 600);
	assert.equal(bill.totalPayable, 1600);
	assert.equal(bill.creditAmount, 600);
	assert.equal(bill.dueAmount, 1000);
});

test("an unpaid month opens the next one at exactly that figure", () => {
	const august = billFrom(month({ meals: 10, grocery: 1000 }));

	const september = billFrom(
		month({ meals: 5, grocery: 500, openingBalance: august.dueAmount }),
	);

	assert.equal(september.openingBalance, 1000);
	assert.equal(september.mealCost, 500);
	assert.equal(september.advanceCharged, 600);
	assert.equal(september.totalPayable, 2100);
	assert.equal(september.dueAmount, 1500);
});

test("settling a month in full leaves the next one owing only its own costs", () => {
	const september = billFrom(
		month({ meals: 5, grocery: 500, openingBalance: 0 }),
	);

	assert.equal(september.dueAmount, 500);
});

test("a member the mess owes carries the credit forward, not a charge", () => {
	const august = billFrom(
		month({ meals: 2, grocery: 200, paidExpenseTotal: 900 }),
	);

	assert.ok(august.dueAmount < 0, `expected a credit, got ${august.dueAmount}`);

	const september = billFrom(
		month({ meals: 5, grocery: 500, openingBalance: august.dueAmount }),
	);

	assert.equal(september.openingBalance, august.dueAmount);
	assert.equal(
		september.totalPayable,
		Number((august.dueAmount + 500 + 600).toFixed(2)),
	);
});

test("three months of carrying compound rather than reset", () => {
	let opening = 0;

	for (const meals of [10, 5, 8]) {
		const bill = billFrom(
			month({ meals, grocery: meals * 100, openingBalance: opening }),
		);

		assert.equal(bill.openingBalance, opening);

		opening = bill.dueAmount;
	}

	assert.equal(opening, 10 * 100 + 5 * 100 + 8 * 100 + 3 * 600 - 3 * 600);
});

test("a mess that takes no deposit behaves exactly as before", () => {
	const bill = computeSettlement({
		...month({ meals: 10, grocery: 1000, depositTotal: 0 }),
		monthlyDeposit: 0,
	}).bills[0]!;

	assert.equal(bill.advanceCharged, 0);
	assert.equal(bill.openingBalance, 0);
	assert.equal(bill.totalPayable, 1000);
	assert.equal(bill.dueAmount, 1000);
});

test("the deposit charged this month is the credit that clears next month", () => {
	const august = billFrom(month({ meals: 10, grocery: 1000 }));

	const septemberIfPaid = billFrom(
		month({ meals: 10, grocery: 1000, openingBalance: 0 }),
	);

	assert.equal(august.advanceCharged, septemberIfPaid.depositTotal);
});

test("someone who left before the month shares none of its bills", () => {
	const gone = {
		memberId: "jubayer",
		mealCount: 0,
		depositTotal: 0,
		paidExpenseTotal: 0,
		openingBalance: -300,
		daysPresent: 0,
	};

	assert.equal(sharesTheMonth(gone), false);
	assert.equal(sharesTheMonth({ ...gone, daysPresent: 15 }), true);
	assert.equal(sharesTheMonth({ ...gone, depositTotal: 500 }), true);
});

test("reopening the month that carried a bill gives the bill its balance back", () => {
	const august = billFrom(month({ meals: 10, grocery: 1000 }));

	assert.deepEqual(
		uncarriedBill({
			totalPayable: august.totalPayable,
			creditAmount: august.creditAmount,
			paidAmount: 0,
		}),
		{ dueAmount: august.dueAmount, status: "UNPAID" },
	);
	assert.deepEqual(
		uncarriedBill({ totalPayable: 2100, creditAmount: 600, paidAmount: 500.5 }),
		{ dueAmount: 999.5, status: "PARTIAL" },
	);
});

test("a carried credit comes back as a credit", () => {
	assert.deepEqual(
		uncarriedBill({ totalPayable: 800, creditAmount: 1500, paidAmount: 0 }),
		{ dueAmount: -700, status: "UNPAID" },
	);
});
