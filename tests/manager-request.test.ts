import assert from "node:assert/strict";
import { test } from "node:test";

import { AuthValidation } from "../src/app/module/auth/auth.validation";
import { ManagerRequestValidation } from "../src/app/module/managerRequest/managerRequest.validation";

const register = AuthValidation.RegisterUserZodSchema;
const { ApplyForManagerValidationZodSchema: apply, ReviewManagerRequestValidationZodSchema: review } =
	ManagerRequestValidation;

const account = {
	name: "Arman Hossain",
	email: "arman@messmate.test",
	password: "Arman@mess123",
};

const issuePaths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
	(result.error?.issues ?? []).map((issue) => issue.path.join("."));

test("signing up to run a mess needs the mess name and address", () => {
	const missing = register.safeParse({ ...account, role: "MESS_MANAGER" });
	assert.equal(missing.success, false);
	assert.deepEqual(issuePaths(missing).sort(), ["messAddress", "messName"]);

	const complete = register.safeParse({
		...account,
		role: "MESS_MANAGER",
		messName: "  Green View Mess ",
		messAddress: "House 12, Road 3, Nasirabad",
	});
	assert.equal(complete.success, true);
	assert.equal(complete.data?.messName, "Green View Mess");
});

test("signing up as a member needs no mess details", () => {
	assert.equal(register.safeParse({ ...account, role: "MEMBER" }).success, true);
	assert.equal(register.safeParse(account).success, true);
});

test("a request to run a mess uses the same limits as the mess itself", () => {
	assert.equal(apply.safeParse({ messName: "GV", messAddress: "Nasirabad" }).success, false);
	assert.equal(apply.safeParse({ messName: "Green View", messAddress: "  " }).success, false);
	assert.equal(
		apply.safeParse({ messName: "Green View", messAddress: "Nasirabad" }).success,
		true,
	);
});

test("rejecting a request needs a reason, approving does not", () => {
	const requestId = "0b3e6f2a-7c1d-4e5f-9a8b-1c2d3e4f5a6b";

	const rejectedSilently = review.safeParse({ requestId, status: "REJECTED" });
	assert.equal(rejectedSilently.success, false);
	assert.deepEqual(issuePaths(rejectedSilently), ["rejectionReason"]);

	assert.equal(
		review.safeParse({ requestId, status: "REJECTED", rejectionReason: "Address not found" })
			.success,
		true,
	);
	assert.equal(review.safeParse({ requestId, status: "APPROVED" }).success, true);
	assert.equal(review.safeParse({ requestId, status: "PENDING" }).success, false);
	assert.equal(review.safeParse({ requestId: "42", status: "APPROVED" }).success, false);
});
