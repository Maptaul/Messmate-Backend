import assert from "node:assert/strict";
import { test } from "node:test";

import { executeBkashPayment } from "../src/app/lib/bkash";

// What the sandbox sent on 2026-09-13: a raw control character inside a string.
const CONTROL_CHAR = String.fromCharCode(1);

const brokenBody = `{"statusCode": "0000", "statusMessage": "Succ${CONTROL_CHAR}essful"}`;

const completed = {
	statusCode: "0000",
	transactionStatus: "Completed",
	trxID: "TRX1",
	amount: "13850.00",
	currency: "BDT",
};

const stubFetch = (t: import("node:test").TestContext, bodies: string[]) => {
	const paths: string[] = [];

	t.mock.method(console, "error", () => {});
	t.mock.method(globalThis, "fetch", async (url: string) => {
		paths.push(url.split("/checkout/")[1]);

		return new Response(bodies[paths.length - 1]);
	});

	return paths;
};

test("an unreadable execute answer falls back to payment status", async (t) => {
	const paths = stubFetch(t, [brokenBody, JSON.stringify(completed)]);

	const result = await executeBkashPayment("token", "TR1");

	assert.deepEqual(paths, ["execute", "payment/status"]);
	assert.equal(result?.transactionStatus, "Completed");
	assert.equal(result?.trxID, "TRX1");
});

test("a readable execute answer is used without asking again", async (t) => {
	const paths = stubFetch(t, [JSON.stringify(completed)]);

	const result = await executeBkashPayment("token", "TR1");

	assert.deepEqual(paths, ["execute"]);
	assert.equal(result?.transactionStatus, "Completed");
});

test("when bKash gives no usable answer at all, nothing is decided", async (t) => {
	const paths = stubFetch(t, [brokenBody, brokenBody]);

	assert.equal(await executeBkashPayment("token", "TR1"), null);
	assert.deepEqual(paths, ["execute", "payment/status"]);
});
