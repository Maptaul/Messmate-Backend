import httpStatus from "http-status";
import { MemberStatus, Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import type { RequestUser } from "../middleware/checkAuth";
import { AppError } from "./AppError";

const findActiveMembership = (messId: string, userId: string) =>
	prisma.messMember.findFirst({
		where: {
			messId,
			userId,
			status: MemberStatus.ACTIVE,
			isDeleted: false,
		},
		select: { id: true, joinedAt: true, leftAt: true },
	});

/**
 * Answers "may THIS user touch THIS mess", and hands back who they are inside it.
 *
 * `auth(...)` only proves the caller has the right kind of account. It cannot
 * prove the mess is theirs, because that needs the row. Every service that takes
 * a messId, cycleId, billId or expenseId must call this - without it, manager B
 * can edit manager A ledger using a perfectly valid token.
 *
 * The returned value is the caller own MessMember row, or null if they have
 * none. **A manager has one.** They live in the mess like everyone else: they
 * eat the meals, take their turn at the grocery run, and get a bill at the end
 * of the month. Managing is extra responsibility, not a different kind of
 * residency. Returning null for them would lock them out of every "my own"
 * view - their meal calendar, their meals, their bill - in their own mess.
 *
 * Only ADMIN gets null, because a platform admin oversees messes without living
 * in one.
 */
export const checkMessAccess = async (messId: string, user: RequestUser) => {
	if (user.role === Role.ADMIN) {
		return null;
	}

	if (user.role === Role.MESS_MANAGER) {
		const mess = await prisma.mess.findFirst({
			where: { id: messId, managerId: user.userId, isDeleted: false },
			select: { id: true },
		});

		if (!mess) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not The Manager Of This Mess",
			);
		}

		// Created alongside the mess, so it is normally present. It can still be
		// missing for a mess made before that behaviour existed, and a manager who
		// is not a resident is a legitimate arrangement, so this is not an error -
		// they simply have no personal rows to show.
		return findActiveMembership(messId, user.userId);
	}

	const membership = await findActiveMembership(messId, user.userId);

	if (!membership) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You Are Not A Member Of This Mess",
		);
	}

	return membership;
};
