import httpStatus from "http-status";
import { MemberStatus, Role } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import type { RequestUser } from "../middleware/checkAuth";
import { AppError } from "./AppError";

/**
 * Answers "may THIS user touch THIS mess".
 *
 * `auth(...)` only proves the caller has the right kind of account. It cannot
 * prove the mess is theirs, because that needs the row. Every service that
 * takes a messId, cycleId, billId or expenseId must call this — without it,
 * manager B can edit manager A ledger using a perfectly valid token.
 *
 * Returns the caller MessMember row when the caller is a MEMBER, so the service
 * can go on to filter rows down to that member. ADMIN and MESS_MANAGER get null,
 * since they read the whole mess.
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

		return null;
	}

	const membership = await prisma.messMember.findFirst({
		where: {
			messId,
			userId: user.userId,
			status: MemberStatus.ACTIVE,
			isDeleted: false,
		},
		select: { id: true, joinedAt: true, leftAt: true },
	});

	if (!membership) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You Are Not A Member Of This Mess",
		);
	}

	return membership;
};
