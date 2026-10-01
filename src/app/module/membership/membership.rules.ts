import { randomBytes } from "node:crypto";
import {
	type MembershipRequestKind,
	Role,
} from "../../../generated/prisma/enums";

// Six hex characters: the same shape the database default gives a new mess.
export const JOIN_CODE_PATTERN = /^[0-9A-F]{6}$/;

/** People type codes from a chat message: ignore case, spaces and dashes. */
export const normalizeJoinCode = (code: string) =>
	code.replace(/[\s-]/g, "").toUpperCase();

// ponytail: 16.7M codes and no retry; a collision fails one regenerate with a
// 409. Lengthen the code or retry on P2002 if messes ever number in millions.
export const newJoinCode = () => randomBytes(3).toString("hex").toUpperCase();

type TActor = { userId: string; role: Role };

type TPendingRequest = {
	kind: MembershipRequestKind;
	userId: string;
	createdById: string;
	mess: { managerId: string };
};

/**
 * Who answers: an invite is the invited person's to accept or decline; a
 * request to join is the mess manager's (or an admin's) to approve or reject.
 */
export const canDecide = (request: TPendingRequest, actor: TActor) =>
	request.kind === "INVITE"
		? actor.userId === request.userId
		: actor.role === Role.ADMIN || actor.userId === request.mess.managerId;

/** Whoever sent it can take it back; an admin can clear anything. */
export const canCancel = (request: TPendingRequest, actor: TActor) =>
	actor.role === Role.ADMIN || actor.userId === request.createdById;
