import httpStatus from "http-status";
import {
	AuditAction,
	BillStatus,
	MemberStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { MessMemberWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type { IAddMemberPayload } from "./member.interface";

const memberSelect = {
	id: true,
	status: true,
	joinedAt: true,
	leftAt: true,
	user: { select: { id: true, name: true, email: true, phone: true, avatarUrl: true } },
	mess: { select: { id: true, name: true } },
};

const addMember = async (payload: IAddMemberPayload, user: RequestUser) => {
	const email = payload.email.trim().toLowerCase();

	const mess = await prisma.mess.findFirst({
		where: { id: payload.messId, isDeleted: false },
		select: { id: true },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess Not Found");
	}

	await checkMessAccess(payload.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Add Members",
		);
	}

	const invitedUser = await prisma.user.findUnique({
		where: { email },
		select: { id: true, name: true, email: true, role: true, isDeleted: true },
	});

	if (!invitedUser || invitedUser.isDeleted) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No User Found With This Email. Ask Them To Register First.",
		);
	}

	if (invitedUser.role === Role.ADMIN) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"A Platform Admin Cannot Be Added As A Mess Member",
		);
	}

	const existingMembership = await prisma.messMember.findUnique({
		where: {
			messId_userId: { messId: payload.messId, userId: invitedUser.id },
		},
	});

	if (existingMembership) {
		if (
			existingMembership.status === MemberStatus.ACTIVE &&
			!existingMembership.isDeleted
		) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This User Is Already An Active Member Of This Mess",
			);
		}

		// The unique constraint on (messId, userId) means a member who left still
		// occupies the slot, so rejoining restores that row instead of inserting a
		// second one. joinedAt is reset because rent is prorated from it.
		return prisma.messMember.update({
			where: { id: existingMembership.id },
			data: {
				status: MemberStatus.ACTIVE,
				joinedAt: new Date(),
				leftAt: null,
				isDeleted: false,
				deletedAt: null,
			},
			select: memberSelect,
		});
	}

	return prisma.messMember.create({
		data: {
			messId: payload.messId,
			userId: invitedUser.id,
			status: MemberStatus.ACTIVE,
		},
		select: memberSelect,
	});
};

const getMessMembers = async (
	messId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const mess = await prisma.mess.findFirst({
		where: { id: messId, isDeleted: false },
		select: { id: true },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess Not Found");
	}

	await checkMessAccess(messId, user);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "joinedAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "asc";

	const andConditions: MessMemberWhereInput[] = [{ messId, isDeleted: false }];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	if (query.searchTerm) {
		andConditions.push({
			user: {
				OR: [
					{ name: { contains: query.searchTerm, mode: "insensitive" } },
					{ email: { contains: query.searchTerm, mode: "insensitive" } },
				],
			},
		});
	}

	const members = await prisma.messMember.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: memberSelect,
	});

	const total = await prisma.messMember.count({ where: { AND: andConditions } });

	return {
		data: members,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const getMyMemberships = async (query: IQuery, user: RequestUser) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "joinedAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: MessMemberWhereInput[] = [
		{ userId: user.userId, isDeleted: false },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const memberships = await prisma.messMember.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: {
			...memberSelect,
			mess: {
				select: { id: true, name: true, address: true, monthlyRent: true },
			},
		},
	});

	const total = await prisma.messMember.count({ where: { AND: andConditions } });

	return {
		data: memberships,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const removeMember = async (memberId: string, user: RequestUser) => {
	const member = await prisma.messMember.findFirst({
		where: { id: memberId, isDeleted: false },
		select: {
			id: true,
			messId: true,
			userId: true,
			status: true,
			mess: { select: { managerId: true } },
		},
	});

	if (!member) {
		throw new AppError(httpStatus.NOT_FOUND, "Member Not Found");
	}

	await checkMessAccess(member.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Remove Members",
		);
	}

	if (member.status === MemberStatus.LEFT) {
		throw new AppError(httpStatus.CONFLICT, "This Member Has Already Left");
	}

	// Removing the manager would leave the mess without one, and their own
	// membership is created with the mess.
	if (member.userId === member.mess.managerId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"The Mess Manager Cannot Be Removed From Their Own Mess",
		);
	}

	// Someone who still owes money cannot be quietly dropped from the ledger.
	const unpaidBill = await prisma.memberBill.findFirst({
		where: {
			memberId,
			status: { in: [BillStatus.UNPAID, BillStatus.PARTIAL] },
			dueAmount: { gt: 0 },
		},
		select: { id: true, dueAmount: true },
	});

	if (unpaidBill) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This Member Has An Unpaid Bill Of ${unpaidBill.dueAmount}. Settle It Before Removing Them.`,
		);
	}

	// LEFT rather than deleted: their meals and expenses stay in the closed
	// months they belong to, and rent stays prorated to the day they left.
	return prisma.$transaction(async (tx) => {
		const updated = await tx.messMember.update({
			where: { id: memberId },
			data: { status: MemberStatus.LEFT, leftAt: new Date() },
			select: memberSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.MEMBER_REMOVED,
			entity: "MessMember",
			entityId: memberId,
			before: { status: member.status },
			after: { status: MemberStatus.LEFT },
		});

		return updated;
	});
};

export const MemberServices = {
	addMember,
	getMessMembers,
	getMyMemberships,
	removeMember,
};
