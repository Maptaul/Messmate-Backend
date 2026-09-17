import assert from "node:assert/strict";
import { test } from "node:test";

import { Role } from "../src/generated/prisma/enums";
import { feedScope } from "../src/app/module/mess/mess.service";

test("a member sees only rows about themselves", () => {
	assert.deepEqual(feedScope("mess-1", Role.MEMBER, "me"), [
		{ messId: "mess-1" },
		{ subjectMemberId: "me" },
	]);
});

test("a member asking for someone else still gets only their own rows", () => {
	assert.deepEqual(feedScope("mess-1", Role.MEMBER, "me", "someone-else"), [
		{ messId: "mess-1" },
		{ subjectMemberId: "me" },
	]);
});

test("a member with no membership matches nothing rather than everything", () => {
	assert.deepEqual(feedScope("mess-1", Role.MEMBER, undefined), [
		{ messId: "mess-1" },
		{ subjectMemberId: "" },
	]);
});

test("a manager sees the whole mess and can narrow it to one member", () => {
	assert.deepEqual(feedScope("mess-1", Role.MESS_MANAGER, "mgr"), [
		{ messId: "mess-1" },
	]);

	assert.deepEqual(feedScope("mess-1", Role.MESS_MANAGER, "mgr", "tarak"), [
		{ messId: "mess-1" },
		{ subjectMemberId: "tarak" },
	]);
});
