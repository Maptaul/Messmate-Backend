import assert from "node:assert/strict";
import { test } from "node:test";

import { depositFundedGroceryWarning } from "../src/app/module/cycle/cycle.settlement";

const personalGrocery = { type: "GROCERY" as const, paidByMemberId: "samir" };
const fundGrocery = { type: "GROCERY" as const, paidByMemberId: null };
const fundElectricity = {
	type: "ELECTRICITY" as const,
	paidByMemberId: null,
};

test("warns when deposits were taken but the fund bought nothing", () => {
	const warning = depositFundedGroceryWarning({
		depositTotal: 4800,
		expenses: [personalGrocery],
	});

	assert.ok(warning);
	assert.match(warning, /Grocery Expense With No Payer/);
});

test("stays quiet once the fund's shopping is recorded", () => {
	assert.equal(
		depositFundedGroceryWarning({
			depositTotal: 4800,
			expenses: [personalGrocery, fundGrocery],
		}),
		null,
	);
});

test("stays quiet when no deposits were taken at all", () => {
	assert.equal(
		depositFundedGroceryWarning({ depositTotal: 0, expenses: [] }),
		null,
	);
});

test("an unpaid bill for something other than food does not count", () => {
	assert.ok(
		depositFundedGroceryWarning({
			depositTotal: 4800,
			expenses: [personalGrocery, fundElectricity],
		}),
	);
});

test("a cycle with deposits and no expenses at all still warns", () => {
	assert.ok(
		depositFundedGroceryWarning({ depositTotal: 600, expenses: [] }),
	);
});
