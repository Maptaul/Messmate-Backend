import assert from "node:assert/strict";
import { test } from "node:test";

import { isStripeSessionSettleable, toPoisha } from "../src/app/lib/stripe";
import { isCredentialRoute } from "../src/app/utils/credentialRoute";

const paid = { payment_status: "paid", currency: "bdt", amount_total: 1385050 };

test("a paid BDT session for the exact amount settles the bill", () => {
	assert.equal(toPoisha(13850.5), 1385050);
	assert.equal(isStripeSessionSettleable(paid, 13850.5), true);
});

test("a session that is unpaid, in another currency, or for another amount does not", () => {
	assert.equal(isStripeSessionSettleable({ ...paid, payment_status: "unpaid" }, 13850.5), false);
	assert.equal(isStripeSessionSettleable({ ...paid, currency: "usd" }, 13850.5), false);
	assert.equal(isStripeSessionSettleable({ ...paid, amount_total: 100 }, 13850.5), false);
	assert.equal(isStripeSessionSettleable({ ...paid, amount_total: null }, 13850.5), false);
});

test("only password and OTP endpoints get the strict auth budget", () => {
	const credential = (originalUrl: string) => isCredentialRoute({ originalUrl });

	assert.equal(credential("/api/v1/auth/login"), true);
	assert.equal(credential("/api/v1/auth/verify-email"), true);
	assert.equal(credential("/api/v1/auth/reset-password"), true);
	assert.equal(credential("/api/v1/auth/me"), false);
	assert.equal(credential("/api/v1/auth/me?x=1"), false);
	assert.equal(credential("/api/v1/auth/refresh-token"), false);
	assert.equal(credential("/api/v1/auth/logout"), false);
	assert.equal(credential("/api/v1/auth/merge"), true);
	assert.equal(credential("/api/v1/mess/my-messes"), false);
});
