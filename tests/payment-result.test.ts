import assert from "node:assert/strict";
import { test } from "node:test";

import { renderPaymentResult } from "../src/app/module/payment/payment.result";

test("tells a payer their bill went through", () => {
	const page = renderPaymentResult("success");

	assert.match(page, /Payment received/);
	assert.match(page, /bill has been updated/);
});

test("tells a payer nothing was charged when they cancelled", () => {
	const page = renderPaymentResult("cancel");

	assert.match(page, /Payment cancelled/);
	assert.match(page, /nothing was charged/);
});

test("treats an unknown status as a failure rather than a success", () => {
	for (const status of ["failure", "", "banana", "SUCCESS"]) {
		const page = renderPaymentResult(status);

		assert.match(page, /Payment did not go through/, `status=${status}`);
		assert.doesNotMatch(page, /Payment received/, `status=${status}`);
	}
});

test("renders a whole page a phone browser can display", () => {
	const page = renderPaymentResult("success");

	assert.match(page, /^<!doctype html>/);
	assert.match(page, /<meta name="viewport"/);
	assert.match(page, /<\/html>$/);
});
