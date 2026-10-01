import assert from "node:assert/strict";
import { test } from "node:test";

import { Role } from "../src/generated/prisma/enums";
import {
	canCancel,
	canDecide,
	JOIN_CODE_PATTERN,
	newJoinCode,
	normalizeJoinCode,
} from "../src/app/module/membership/membership.rules";
import { MembershipValidation } from "../src/app/module/membership/membership.validation";

const manager = { userId: "manager-1", role: Role.MESS_MANAGER };
const otherManager = { userId: "manager-2", role: Role.MESS_MANAGER };
const admin = { userId: "admin-1", role: Role.ADMIN };
const rahim = { userId: "rahim", role: Role.MEMBER };
const karim = { userId: "karim", role: Role.MEMBER };

const invite = {
	kind: "INVITE" as const,
	userId: "rahim",
	createdById: "manager-1",
	mess: { managerId: "manager-1" },
};

const request = {
	kind: "REQUEST" as const,
	userId: "rahim",
	createdById: "rahim",
	mess: { managerId: "manager-1" },
};

test("an invitation is answered only by the person invited", () => {
	assert.equal(canDecide(invite, rahim), true);
	assert.equal(canDecide(invite, karim), false);
	assert.equal(canDecide(invite, manager), false);
	assert.equal(canDecide(invite, admin), false);
});

test("a request to join is answered by that mess's manager or an admin", () => {
	assert.equal(canDecide(request, manager), true);
	assert.equal(canDecide(request, admin), true);
	assert.equal(canDecide(request, otherManager), false);
	assert.equal(canDecide(request, rahim), false);
});

test("whoever sent an invitation or request can withdraw it, and an admin can", () => {
	assert.equal(canCancel(invite, manager), true);
	assert.equal(canCancel(invite, rahim), false);
	assert.equal(canCancel(request, rahim), true);
	assert.equal(canCancel(request, manager), false);
	assert.equal(canCancel(request, admin), true);
});

test("join codes are six hex characters, typed any way a chat message has them", () => {
	for (let i = 0; i < 50; i++) {
		assert.match(newJoinCode(), JOIN_CODE_PATTERN);
	}

	assert.equal(normalizeJoinCode(" 3fa-9c2 "), "3FA9C2");

	const join = MembershipValidation.RequestToJoinValidationZodSchema;
	assert.equal(join.safeParse({ joinCode: "3fa 9c2" }).data?.joinCode, "3FA9C2");
	assert.equal(join.safeParse({ joinCode: "3FA9C" }).success, false);
	assert.equal(join.safeParse({ joinCode: "3FA9CZ" }).success, false);
	assert.equal(
		join.safeParse({ joinCode: "3FA9C2", note: "x".repeat(301) }).success,
		false,
	);
});

test("an invitation needs the mess and a valid email", () => {
	const inviteSchema = MembershipValidation.InviteMemberValidationZodSchema;
	assert.equal(
		inviteSchema.safeParse({ messId: "m1", email: "rahim@messmate.test" }).success,
		true,
	);
	assert.equal(inviteSchema.safeParse({ messId: "m1", email: "rahim" }).success, false);
	assert.equal(inviteSchema.safeParse({ email: "rahim@messmate.test" }).success, false);
});
