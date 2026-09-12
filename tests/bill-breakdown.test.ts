import assert from "node:assert/strict";
import { test } from "node:test";

import {
	computeSettlement,
	type SettlementInput,
} from "../src/app/module/cycle/cycle.settlement";

const HEADS = 8;

const KHALA_PER_HEAD = 438;
const UTILITIES_PER_HEAD = 400;
const RENT_PER_HEAD = 1600;
const DEPOSIT_PER_HEAD = 600;

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

const august: SettlementInput = {
	monthlyRent: RENT_PER_HEAD * HEADS,
	monthlyDeposit: DEPOSIT_PER_HEAD,
	daysInMonth: 31,
	members: ledger.map((m) => ({
		memberId: m.name,
		mealCount: m.meals,
		depositTotal: DEPOSIT_PER_HEAD,
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
		{
			type: "GROCERY" as const,
			amount: DEPOSIT_PER_HEAD * HEADS,
			splitMethod: "BY_MEAL" as const,
		},
		{
			type: "MAID" as const,
			amount: KHALA_PER_HEAD * HEADS,
			splitMethod: "EQUAL" as const,
		},
		{
			type: "ELECTRICITY" as const,
			amount: UTILITIES_PER_HEAD * HEADS,
			splitMethod: "EQUAL" as const,
		},
	],
};

const result = computeSettlement(august);
const billOf = (name: string) => result.bills.find((b) => b.memberId === name)!;

test("every bill itemises the shared costs instead of lumping them", () => {
	const tarak = billOf("tarak");

	assert.deepEqual(
		tarak.sharedBreakdown.map((s) => s.type),
		["MAID", "ELECTRICITY"],
	);
});

test("khala comes before the utilities, the way the sheet reads", () => {
	for (const bill of result.bills) {
		assert.equal(bill.sharedBreakdown[0]?.type, "MAID", bill.memberId);
	}
});

test("the itemised lines add back up to the shared total", () => {
	for (const bill of result.bills) {
		const summed = bill.sharedBreakdown.reduce((sum, s) => sum + s.amount, 0);

		assert.equal(Number(summed.toFixed(2)), bill.sharedCost, bill.memberId);
	}
});

test("khala and utilities are split by head, not by meals", () => {
	const shares = result.bills.map((b) => b.sharedCost);

	assert.deepEqual(
		[...new Set(shares)],
		[KHALA_PER_HEAD + UTILITIES_PER_HEAD],
		"every member should carry the same shared cost",
	);
});

test("each khala line is the monthly khala split eight ways", () => {
	for (const bill of result.bills) {
		const khala = bill.sharedBreakdown.find((s) => s.type === "MAID");

		assert.equal(khala?.amount, KHALA_PER_HEAD, bill.memberId);
	}
});

test("rent lands at the sheet's per-head figure", () => {
	for (const bill of result.bills) {
		assert.equal(bill.rentShare, RENT_PER_HEAD, bill.memberId);
	}
});

test("the deposit and the member's own bazaar stay separate", () => {
	const rafi = billOf("rafi");

	assert.equal(rafi.depositTotal, DEPOSIT_PER_HEAD);
	assert.equal(rafi.paidExpenseTotal, 1850);
	assert.equal(rafi.creditAmount, DEPOSIT_PER_HEAD + 1850);
});

test("the meal rate is unchanged by adding khala, utilities and rent", () => {
	assert.equal(result.mealRate, 48.7965);
	assert.equal(result.totalGrocery, 13785);
});

test("a member's total payable is the sum of every line on the sheet", () => {
	for (const bill of result.bills) {
		const lines =
			bill.openingBalance +
			bill.mealCost +
			bill.sharedBreakdown.reduce((sum, s) => sum + s.amount, 0) +
			bill.rentShare +
			bill.advanceCharged;

		assert.equal(Number(lines.toFixed(2)), bill.totalPayable, bill.memberId);
	}
});

test("the whole month still balances once everything is charged", () => {
	const payable = result.bills.reduce((sum, b) => sum + b.totalPayable, 0);
	const charged =
		13785 +
		(KHALA_PER_HEAD + UTILITIES_PER_HEAD + RENT_PER_HEAD + DEPOSIT_PER_HEAD) *
			HEADS;

	assert.equal(Number(payable.toFixed(2)), charged);
});

test("next month's deposit is charged to everyone, once", () => {
	for (const bill of result.bills) {
		assert.equal(bill.advanceCharged, DEPOSIT_PER_HEAD, bill.memberId);
	}
});

test("nobody carries a balance into a mess's first month", () => {
	for (const bill of result.bills) {
		assert.equal(bill.openingBalance, 0, bill.memberId);
	}
});

test("Tarak's bill matches the line on the paper sheet", () => {
	const tarak = billOf("tarak");

	const fixedBlock =
		KHALA_PER_HEAD + UTILITIES_PER_HEAD + DEPOSIT_PER_HEAD + RENT_PER_HEAD;

	assert.equal(fixedBlock, 3038);

	assert.equal(tarak.mealCount, 33);
	assert.equal(tarak.mealCost, 1610.28);
	assert.equal(tarak.creditAmount, 1230);
	assert.equal(tarak.totalPayable, 4648.28);
	assert.equal(tarak.dueAmount, 3418.28);

	const netMeal = tarak.mealCost - tarak.creditAmount;

	assert.equal(Number((netMeal + fixedBlock).toFixed(2)), tarak.dueAmount);
});

test("the paper's 3425 differs only because the mess rounds the rate to 49", () => {
	const tarak = billOf("tarak");

	const byHand = 33 * 49 - 1230 + 3038;

	assert.equal(byHand, 3425);
	assert.equal(Number((byHand - tarak.dueAmount).toFixed(2)), 6.72);
	assert.equal(Number((33 * (49 - result.mealRate)).toFixed(2)), 6.72);
});
