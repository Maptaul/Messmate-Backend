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

const memberSelect = {
	id: true,
	status: true,
	joinedAt: true,
	leftAt: true,
	defaultLunch: true,
	defaultDinner: true,
	user: {
		select: { id: true, name: true, email: true, phone: true, avatarUrl: true },
	},
	mess: { select: { id: true, name: true } },
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

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
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

	const total = await prisma.messMember.count({
		where: { AND: andConditions },
	});

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
	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
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

	const total = await prisma.messMember.count({
		where: { AND: andConditions },
	});

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

// The bill check removeMember also makes: nobody walks away owing the mess.
const findUnpaidBill = (memberId: string) =>
	prisma.memberBill.findFirst({
		where: {
			memberId,
			status: { in: [BillStatus.UNPAID, BillStatus.PARTIAL] },
			dueAmount: { gt: 0 },
		},
		select: { id: true, dueAmount: true },
	});

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

	if (member.userId === member.mess.managerId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"The Mess Manager Cannot Be Removed From Their Own Mess",
		);
	}

	const unpaidBill = await findUnpaidBill(memberId);

	if (unpaidBill) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This Member Has An Unpaid Bill Of ${unpaidBill.dueAmount}. Settle It Before Removing Them.`,
		);
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.messMember.update({
			where: { id: memberId },
			data: { status: MemberStatus.LEFT, leftAt: new Date() },
			select: memberSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.MEMBER_REMOVED,
			messId: member.messId,
			subjectMemberId: memberId,
			entity: "MessMember",
			entityId: memberId,
			before: { status: member.status },
			after: { status: MemberStatus.LEFT },
		});

		return updated;
	});
};

const leaveMess = async (messId: string, user: RequestUser) => {
	const member = await prisma.messMember.findFirst({
		where: {
			messId,
			userId: user.userId,
			status: MemberStatus.ACTIVE,
			isDeleted: false,
		},
		select: { id: true, status: true, mess: { select: { managerId: true } } },
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"You Are Not A Member Of This Mess",
		);
	}

	if (member.mess.managerId === user.userId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"A Manager Cannot Leave Their Own Mess",
		);
	}

	const unpaidBill = await findUnpaidBill(member.id);

	if (unpaidBill) {
		throw new AppError(
			httpStatus.CONFLICT,
			`You Have An Unpaid Bill Of ${unpaidBill.dueAmount}. Pay It Before Leaving.`,
		);
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.messMember.update({
			where: { id: member.id },
			data: { status: MemberStatus.LEFT, leftAt: new Date() },
			select: memberSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.MEMBER_LEFT,
			messId,
			subjectMemberId: member.id,
			entity: "MessMember",
			entityId: member.id,
			before: { status: member.status },
			after: { status: MemberStatus.LEFT },
		});

		return updated;
	});
};

export const MemberServices = {
	leaveMess,
	getMessMembers,
	getMyMemberships,
	removeMember,
};
