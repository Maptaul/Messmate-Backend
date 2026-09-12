import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import ejs from "ejs";

import { monthName, taka } from "../src/app/utils/months";

const render = (template: string, data: Record<string, unknown>) =>
	ejs.renderFile(
		path.join(process.cwd(), `src/app/templates/${template}.ejs`),
		data,
	);

const billBase = {
	userName: "Arman",
	messName: "Chattogram Mess",
	monthName: "August",
	year: 2026,
	totalMeals: 282.5,
	totalGrocery: "13,785.00",
	mealRate: "48.80",
	mealCount: 17.5,
	mealCost: "853.94",
	sharedCost: "838.00",
	sharedLines: [
		{ label: "Khala", amount: "438.00" },
		{ label: "Electricity", amount: "400.00" },
	],
	rentShare: "1,600.00",
	openingBalance: "0.00",
	hasOpeningBalance: false,
	openingWasOwed: false,
	advanceCharged: "600.00",
	hasAdvance: true,
	totalPayable: "3,891.94",
	depositTotal: "600.00",
	paidExpenseTotal: "1,015.00",
	hasDeposit: true,
	hasPaidExpense: true,
	creditAmount: "1,615.00",
	dueAmount: "0.00",
	refundAmount: "761.06",
	owes: false,
	isOwed: true,
	loginUrl: "https://example.test/login",
};

test("the monthly bill shows a member what they owe", async () => {
	const html = await render("monthly-bill", {
		...billBase,
		owes: true,
		isOwed: false,
		dueAmount: "420.50",
	});

	assert.match(html, /August 2026/);
	assert.match(html, /You owe BDT 420\.50/);
	assert.match(html, /Pay my bill/);
	assert.doesNotMatch(html, /mess owes you/);
});

test("the monthly bill shows a member what they are owed back", async () => {
	const html = await render("monthly-bill", billBase);

	assert.match(html, /The mess owes you BDT 761\.06/);
	assert.doesNotMatch(html, /You owe BDT/);
});

test("the monthly bill says so when nothing is owed either way", async () => {
	const html = await render("monthly-bill", {
		...billBase,
		owes: false,
		isOwed: false,
	});

	assert.match(html, /all square/);
});

test("the monthly bill explains where the meal rate came from", async () => {
	const html = await render("monthly-bill", billBase);

	assert.match(html, /13,785\.00/);
	assert.match(html, /282\.5/);
	assert.match(html, /48\.80/);
	assert.match(html, /17\.5/);
});

test("the bill itemises khala and utilities the way the paper sheet does", async () => {
	const html = await render("monthly-bill", billBase);

	assert.match(html, /Khala/);
	assert.match(html, /438.00/);
	assert.match(html, /Electricity/);
	assert.match(html, /Rent share/);
	assert.doesNotMatch(html, /Utilities and other shared bills/);
});

test("the bill separates the deposit from the bazaar a member paid", async () => {
	const html = await render("monthly-bill", billBase);

	assert.match(html, /Deposit<\/th><td>BDT 600\.00/);
	assert.match(html, /Bazaar you paid for yourself<\/th><td>BDT 1,015\.00/);
	assert.match(html, /Total credit<\/th><td>BDT 1,615\.00/);
});

test("the bill falls back to one shared line when nothing is itemised", async () => {
	const html = await render("monthly-bill", {
		...billBase,
		sharedLines: [],
		hasDeposit: false,
		hasPaidExpense: false,
	});

	assert.match(html, /Utilities and other shared bills/);
	assert.doesNotMatch(html, /Khala/);
	assert.doesNotMatch(html, />Deposit</);
});

test("the bill charges next month's deposit as its own line", async () => {
	const html = await render("monthly-bill", billBase);

	assert.match(html, /Next month's deposit<\/th><td>BDT 600\.00/);
});

test("a member who owed last month sees it brought forward", async () => {
	const html = await render("monthly-bill", {
		...billBase,
		hasOpeningBalance: true,
		openingWasOwed: true,
		openingBalance: "387.00",
	});

	assert.match(html, /Brought forward from last month<\/th><td>BDT 387\.00/);
	assert.doesNotMatch(html, /In credit from last month/);
});

test("a member the mess owed sees it as a credit, not a charge", async () => {
	const html = await render("monthly-bill", {
		...billBase,
		hasOpeningBalance: true,
		openingWasOwed: false,
		openingBalance: "761.06",
	});

	assert.match(html, /In credit from last month<\/th><td>BDT - 761\.06/);
	assert.doesNotMatch(html, /Brought forward/);
});

test("a mess that takes no deposit sees neither extra line", async () => {
	const html = await render("monthly-bill", {
		...billBase,
		hasAdvance: false,
		hasOpeningBalance: false,
	});

	assert.doesNotMatch(html, /Next month's deposit/);
	assert.doesNotMatch(html, /last month/);
});

test("the payment receipt confirms a fully settled bill", async () => {
	const html = await render("payment-receipt", {
		userName: "Tarak",
		messName: "Chattogram Mess",
		monthName: "August",
		year: 2026,
		paidNow: "1,230.00",
		paidSoFar: "1,230.00",
		totalPayable: "1,230.00",
		dueAmount: "0.00",
		isFullySettled: true,
			trxId: "BKASH123XYZ",
		isCash: false,
		methodLabel: "bKash BKASH123XYZ",
		invoice: "inv-1",
		paidAt: "2026-09-01",
	});

	assert.match(html, /BDT 1,230\.00/);
	assert.match(html, /BKASH123XYZ/);
	assert.match(html, /fully settled/);
	assert.doesNotMatch(html, /still outstanding/);
});

test("the payment receipt reports what is left after a part payment", async () => {
	const html = await render("payment-receipt", {
		userName: "Tarak",
		messName: "Chattogram Mess",
		monthName: "August",
		year: 2026,
		paidNow: "500.00",
		paidSoFar: "500.00",
		totalPayable: "1,230.00",
		dueAmount: "730.00",
		isFullySettled: false,
			trxId: "BKASH123XYZ",
		isCash: false,
		methodLabel: "bKash BKASH123XYZ",
		invoice: "inv-1",
		paidAt: "2026-09-01",
	});

	assert.match(html, /BDT 730\.00 is still outstanding/);
	assert.doesNotMatch(html, /fully settled/);
});

test("the receipt reads differently when the manager took cash", async () => {
	const html = await render("payment-receipt", {
		userName: "Tarak",
		messName: "Chattogram Mess",
		monthName: "August",
		year: 2026,
		paidNow: "380.28",
		paidSoFar: "380.28",
		totalPayable: "380.28",
		dueAmount: "0.00",
		isFullySettled: true,
		trxId: "-",
		isCash: true,
		methodLabel: "Cash, handed to the manager",
		invoice: "inv-cash-1",
		paidAt: "2026-09-01",
	});

	assert.match(html, /Cash payment recorded/);
	assert.match(html, /Cash, handed to the manager/);
	assert.doesNotMatch(html, /bKash/);
});

test("reopening a cycle tells members their bill no longer stands", async () => {
	const html = await render("bill-withdrawn", {
		userName: "Tarak",
		messName: "Chattogram Mess",
		monthName: "August",
		year: 2026,
		previousDue: "3,418.28",
	});

	assert.match(html, /Ignore your August bill/);
	assert.match(html, /BDT 3,418\.28/);
	assert.match(html, /no longer stands/);
	assert.match(html, /already paid, that payment is safe/);
});

test("the reminder templates still render", async () => {
	const plan = await render("meal-plan-reminder", {
		userName: "Shuvo",
		messName: "Chattogram Mess",
		planDate: "2026-09-11",
		loginUrl: "https://example.test/login",
	});

	const unpaid = await render("unpaid-bill-reminder", {
		userName: "Shuvo",
		messName: "Chattogram Mess",
		monthName: "August",
		year: 2026,
		dueAmount: "420.50",
		loginUrl: "https://example.test/login",
	});

	assert.match(plan, /2026-09-11/);
	assert.match(unpaid, /BDT 420\.50/);
});

test("month numbers become month names", () => {
	assert.equal(monthName(1), "January");
	assert.equal(monthName(8), "August");
	assert.equal(monthName(12), "December");
});

test("money is always shown with two decimals", () => {
	assert.equal(taka(48.7965), "48.80");
	assert.equal(taka(13785), "13,785.00");
	assert.equal(taka("853.9385"), "853.94");
	assert.equal(taka(0), "0.00");
});
