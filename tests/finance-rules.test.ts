import assert from "node:assert/strict";
import { test } from "node:test";

import { categoryFits } from "../src/app/module/finance/finance.constant";
import { FinanceValidation } from "../src/app/module/finance/finance.validation";

const add = FinanceValidation.AddFinanceEntryValidationZodSchema;

test("a category only fits the type it belongs to", () => {
	assert.equal(categoryFits("INCOME", "TUITION"), true);
	assert.equal(categoryFits("EXPENSE", "FOOD"), true);
	assert.equal(categoryFits("INCOME", "FOOD"), false);
	assert.equal(categoryFits("EXPENSE", "SALARY"), false);
});

test("OTHER is available on both sides", () => {
	assert.equal(categoryFits("INCOME", "OTHER"), true);
	assert.equal(categoryFits("EXPENSE", "OTHER"), true);
});

test("an ordinary entry passes, with the date optional", () => {
	const result = add.safeParse({
		type: "EXPENSE",
		category: "MOBILE_INTERNET",
		amount: "19.99",
	});

	assert.equal(result.success, true);
	assert.equal(result.data?.amount, 19.99);
});

test("amounts must be positive, whole paisa and not absurd", () => {
	for (const amount of [0, -5, 1.005, 10000000.01]) {
		const result = add.safeParse({
			type: "INCOME",
			category: "SALARY",
			amount,
		});

		assert.equal(result.success, false, `amount ${amount}`);
	}
});

test("an unknown type or category is refused", () => {
	assert.equal(
		add.safeParse({ type: "LOAN", category: "OTHER", amount: 10 }).success,
		false,
	);
	assert.equal(
		add.safeParse({ type: "EXPENSE", category: "GAMBLING", amount: 10 })
			.success,
		false,
	);
});
