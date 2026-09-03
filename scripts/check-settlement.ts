import assert from "node:assert/strict";

import {
	computeSettlement,
	type SettlementInput,
} from "../src/app/module/cycle/cycle.settlement";

let passed = 0;

const check = (label: string, fn: () => void) => {
	fn();
	passed += 1;
	console.log(`  ok  ${label}`);
};

const mealCounts: Record<string, number> = {
	samir: 62,
	ahir: 55,
	arman: 64,
	parvez: 58,
	rafi: 60,
	shuvo: 70,
	tarek: 52,
	jihan: 59,
};

const july: SettlementInput = {
	monthlyRent: 24000,
	daysInMonth: 30,
	members: Object.entries(mealCounts).map(([memberId, mealCount]) => ({
		memberId,
		mealCount,
		depositTotal: 0,
		paidExpenseTotal: 0,
		daysPresent: 30,
	})),
	expenses: [
		{ type: "GROCERY", amount: 9000, splitMethod: "EQUAL" },
		{ type: "ELECTRICITY", amount: 3600, splitMethod: "EQUAL" },
		{ type: "GAS", amount: 1200, splitMethod: "EQUAL" },
		{ type: "MAID", amount: 4000, splitMethod: "EQUAL" },
		{ type: "RENT", amount: 24000, splitMethod: "EQUAL" },
	],
};

const result = computeSettlement(july);

console.log("\nJuly - 8 members, 480 meals, 9000 grocery, 24000 rent\n");

check("total meals add up to 480", () => {
	assert.equal(result.totalMeals, 480);
});

check("meal rate is 9000 / 480 = 18.75", () => {
	assert.equal(result.mealRate, 18.75);
});

check("grocery total is reported as 9000", () => {
	assert.equal(result.totalGrocery, 9000);
});

check("every meal cost sums to the grocery total exactly", () => {
	const sum = result.bills.reduce((total, b) => total + b.mealCost, 0);
	assert.equal(Number(sum.toFixed(2)), 9000);
});

check("every rent share sums to the full rent exactly", () => {
	const sum = result.bills.reduce((total, b) => total + b.rentShare, 0);
	assert.equal(Number(sum.toFixed(2)), 24000);
});

check("shared costs sum to gas + electricity + maid, and exclude grocery and rent", () => {
	const sum = result.bills.reduce((total, b) => total + b.sharedCost, 0);
	assert.equal(Number(sum.toFixed(2)), 3600 + 1200 + 4000);
});

check("a member with 52 meals is charged 52 x 18.75 = 975", () => {
	const tarek = result.bills.find((b) => b.memberId === "tarek");
	assert.ok(tarek);
	assert.equal(tarek.mealCost, 975);
});

check("payable is meal + shared + rent for every member", () => {
	for (const b of result.bills) {
		assert.equal(
			Number(b.totalPayable.toFixed(2)),
			Number((b.mealCost + b.sharedCost + b.rentShare).toFixed(2)),
		);
	}
});

const withCredit = computeSettlement({
	...july,
	members: july.members.map((m) =>
		m.memberId === "tarek"
			? { ...m, depositTotal: 2000, paidExpenseTotal: 3000 }
			: m,
	),
});

console.log("\nCredit - one member deposited 2000 and paid 3000 of groceries\n");

check("credit is deposits plus expenses they fronted", () => {
	const tarek = withCredit.bills.find((b) => b.memberId === "tarek");
	assert.ok(tarek);
	assert.equal(tarek.creditAmount, 5000);
});

check("due is payable minus credit", () => {
	const tarek = withCredit.bills.find((b) => b.memberId === "tarek");
	assert.ok(tarek);
	assert.equal(
		Number(tarek.dueAmount.toFixed(2)),
		Number((tarek.totalPayable - 5000).toFixed(2)),
	);
});

check("a member who paid more than they consumed goes negative, not to zero", () => {
	const generous = computeSettlement({
		...july,
		members: july.members.map((m) =>
			m.memberId === "shuvo" ? { ...m, paidExpenseTotal: 90000 } : m,
		),
	});

	const shuvo = generous.bills.find((b) => b.memberId === "shuvo");
	assert.ok(shuvo);
	assert.ok(shuvo.dueAmount < 0, "the mess owes this member");
});

console.log("\nRounding - amounts that do not divide cleanly\n");

check("100 taka across 3 members still sums to 100", () => {
	const r = computeSettlement({
		monthlyRent: 0,
		daysInMonth: 30,
		members: ["a", "b", "c"].map((memberId) => ({
			memberId,
			mealCount: 1,
			depositTotal: 0,
			paidExpenseTotal: 0,
			daysPresent: 30,
		})),
		expenses: [{ type: "GAS", amount: 100, splitMethod: "EQUAL" }],
	});

	const sum = r.bills.reduce((total, b) => total + b.sharedCost, 0);
	assert.equal(Number(sum.toFixed(2)), 100);
});

check("1000 grocery across 7 uneven meal counts still sums to 1000", () => {
	const r = computeSettlement({
		monthlyRent: 0,
		daysInMonth: 30,
		members: [3, 11, 17, 23, 29, 31, 41].map((mealCount, i) => ({
			memberId: `m${i}`,
			mealCount,
			depositTotal: 0,
			paidExpenseTotal: 0,
			daysPresent: 30,
		})),
		expenses: [{ type: "GROCERY", amount: 1000, splitMethod: "EQUAL" }],
	});

	const sum = r.bills.reduce((total, b) => total + b.mealCost, 0);
	assert.equal(Number(sum.toFixed(2)), 1000);
});

check("0.01 taka across 4 members gives it to exactly one of them", () => {
	const r = computeSettlement({
		monthlyRent: 0,
		daysInMonth: 30,
		members: ["a", "b", "c", "d"].map((memberId) => ({
			memberId,
			mealCount: 1,
			depositTotal: 0,
			paidExpenseTotal: 0,
			daysPresent: 30,
		})),
		expenses: [{ type: "WATER", amount: 0.01, splitMethod: "EQUAL" }],
	});

	const paid = r.bills.filter((b) => b.sharedCost > 0);
	assert.equal(paid.length, 1);
	assert.equal(paid[0]!.sharedCost, 0.01);
});

check("the same input always produces the same split", () => {
	const a = computeSettlement(july);
	const b = computeSettlement(july);
	assert.deepEqual(a.bills, b.bills);
});

console.log("\nEdge cases\n");

check("a month with no meals has a rate of 0 and no meal cost", () => {
	const r = computeSettlement({
		...july,
		members: july.members.map((m) => ({ ...m, mealCount: 0 })),
	});

	assert.equal(r.mealRate, 0);
	assert.equal(
		r.bills.reduce((total, b) => total + b.mealCost, 0),
		0,
	);
});

check("a BY_MEAL expense in a month with no meals falls back to an equal split", () => {
	const r = computeSettlement({
		monthlyRent: 0,
		daysInMonth: 30,
		members: ["a", "b"].map((memberId) => ({
			memberId,
			mealCount: 0,
			depositTotal: 0,
			paidExpenseTotal: 0,
			daysPresent: 30,
		})),
		expenses: [{ type: "INTERNET", amount: 500, splitMethod: "BY_MEAL" }],
	});

	assert.equal(r.bills[0]!.sharedCost, 250);
	assert.equal(r.bills[1]!.sharedCost, 250);
});

check("rent is shared by days present, and still sums to the full rent", () => {
	const r = computeSettlement({
		monthlyRent: 3000,
		daysInMonth: 30,
		members: [
			{ memberId: "full", mealCount: 10, depositTotal: 0, paidExpenseTotal: 0, daysPresent: 30 },
			{ memberId: "half", mealCount: 10, depositTotal: 0, paidExpenseTotal: 0, daysPresent: 15 },
		],
		expenses: [],
	});

	const sum = r.bills.reduce((total, b) => total + b.rentShare, 0);
	assert.equal(Number(sum.toFixed(2)), 3000);

	const full = r.bills.find((b) => b.memberId === "full")!;
	const half = r.bills.find((b) => b.memberId === "half")!;
	assert.equal(full.rentShare, 2000);
	assert.equal(half.rentShare, 1000);
});

check("rent is still collected in full when nobody has days present", () => {
	const r = computeSettlement({
		monthlyRent: 3000,
		daysInMonth: 30,
		members: ["a", "b"].map((memberId) => ({
			memberId,
			mealCount: 0,
			depositTotal: 0,
			paidExpenseTotal: 0,
			daysPresent: 0,
		})),
		expenses: [],
	});

	const sum = r.bills.reduce((total, b) => total + b.rentShare, 0);
	assert.equal(Number(sum.toFixed(2)), 3000);
});

check("a cycle with no members produces no bills", () => {
	const r = computeSettlement({
		monthlyRent: 24000,
		daysInMonth: 30,
		members: [],
		expenses: [{ type: "GROCERY", amount: 9000, splitMethod: "EQUAL" }],
	});

	assert.equal(r.bills.length, 0);
	assert.equal(r.mealRate, 0);
});

console.log(`\nOK - ${passed} checks passed\n`);
