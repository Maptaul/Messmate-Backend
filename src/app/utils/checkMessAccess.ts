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
