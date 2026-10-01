import httpStatus from "http-status";
import type { AuditAction } from "../../../generated/prisma/enums";
import {
	CycleStatus,
	MemberStatus,
	Role,
} from "../../../generated/prisma/enums";
import type {
	AuditLogWhereInput,
	MessWhereInput,
} from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type { ICreateMessPayload, IUpdateMessPayload } from "./mess.interface";

const messListSelect = {
	id: true,
	name: true,
	address: true,
	monthlyRent: true,
	monthlyDeposit: true,
	createdAt: true,
	manager: { select: { id: true, name: true, email: true } },
	_count: { select: { members: true, cycles: true } },
	// Marks a mess whose month is still open (it can't be deleted yet).
	cycles: {
		where: { status: CycleStatus.OPEN },
		select: { id: true },
		take: 1,
	},
};

const createMess = async (payload: ICreateMessPayload, user: RequestUser) => {
	// A manager runs one mess. Deleting it frees them to start another.
	const managedMess = await prisma.mess.findFirst({
		where: { managerId: user.userId, isDeleted: false },
		select: { id: true },
	});

	if (managedMess) {
		throw new AppError(httpStatus.CONFLICT, "You Already Manage A Mess");
	}

	const mess = await prisma.$transaction(async (tx) => {
		const createdMess = await tx.mess.create({
			data: {
				name: payload.name,
				address: payload.address,
				monthlyRent: payload.monthlyRent,
				monthlyDeposit: payload.monthlyDeposit ?? 0,
				managerId: user.userId,
			},
		});

		await tx.messMember.create({
			data: {
				messId: createdMess.id,
				userId: user.userId,
				status: MemberStatus.ACTIVE,
			},
		});

		return createdMess;
	});

	return mess;
};

const getAllMesses = async (query: IQuery) => {
	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: MessWhereInput[] = [{ isDeleted: false }];

	if (query.managerId) {
		andConditions.push({ managerId: query.managerId });
	}

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ address: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	const messes = await prisma.mess.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: messListSelect,
	});

	const total = await prisma.mess.count({ where: { AND: andConditions } });

	return {
		data: messes,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const getMyMesses = async (query: IQuery, user: RequestUser) => {
	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: MessWhereInput[] = [{ isDeleted: false }];

	if (user.role === Role.MESS_MANAGER) {
		andConditions.push({ managerId: user.userId });
	} else {
		andConditions.push({
			members: {
				some: {
					userId: user.userId,
					status: MemberStatus.ACTIVE,
					isDeleted: false,
				},
			},
		});
	}

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ address: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	const messes = await prisma.mess.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: messListSelect,
	});

	const total = await prisma.mess.count({ where: { AND: andConditions } });

	return {
		data: messes,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const getSingleMess = async (messId: string, user: RequestUser) => {
	const mess = await prisma.mess.findFirst({
		where: { id: messId, isDeleted: false },
		select: {
			...messListSelect,
			cycles: {
				orderBy: [{ year: "desc" }, { month: "desc" }],
				take: 6,
				select: {
					id: true,
					year: true,
					month: true,
					status: true,
					mealRate: true,
					totalMeals: true,
					totalGrocery: true,
					closedAt: true,
					closedBy: { select: { name: true } },
				},
			},
		},
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess Not Found");
	}

	await checkMessAccess(messId, user);

	return mess;
};

const updateMess = async (
	messId: string,
	payload: IUpdateMessPayload,
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

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Update This Mess",
		);
	}

	return prisma.mess.update({
		where: { id: messId },
		data: payload,
	});
};

const deleteMess = async (messId: string, user: RequestUser) => {
	const mess = await prisma.mess.findFirst({
		where: { id: messId, isDeleted: false },
		select: { id: true },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess Not Found");
	}

	await checkMessAccess(messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Delete This Mess",
		);
	}

	const openCycle = await prisma.billingCycle.findFirst({
		where: { messId, status: CycleStatus.OPEN },
		select: { id: true, year: true, month: true },
	});

	if (openCycle) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Close The Billing Cycle For ${openCycle.month}/${openCycle.year} Before Deleting This Mess`,
		);
	}

	return prisma.mess.update({
		where: { id: messId },
		data: { isDeleted: true, deletedAt: new Date() },
		select: { id: true, name: true, isDeleted: true, deletedAt: true },
	});
};

// A member only ever sees rows about themselves, whatever the query asks for.
export const feedScope = (
	messId: string,
	role: Role,
	membershipId: string | undefined,
	requestedMemberId?: string,
): AuditLogWhereInput[] => {
	if (role === Role.MEMBER) {
		return [{ messId }, { subjectMemberId: membershipId ?? "" }];
	}

	return requestedMemberId
		? [{ messId }, { subjectMemberId: requestedMemberId }]
		: [{ messId }];
};

const loadMessMembership = async (messId: string, user: RequestUser) => {
	const mess = await prisma.mess.findFirst({
		where: { id: messId, isDeleted: false },
		select: { id: true },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess Not Found");
	}

	return checkMessAccess(messId, user);
};

const getMessAuditLogs = async (
	messId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const membership = await loadMessMembership(messId, user);

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions = feedScope(
		messId,
		user.role,
		membership?.id,
		query.memberId,
	);

	if (query.action) {
		andConditions.push({ action: query.action as AuditAction });
	}

	if (query.entity) {
		andConditions.push({ entity: query.entity });
	}

	if (query.actorId) {
		andConditions.push({ actorId: query.actorId });
	}

	const where: AuditLogWhereInput = { AND: andConditions };

	const [logs, total] = await Promise.all([
		prisma.auditLog.findMany({
			where,
			take: limit,
			skip,
			orderBy: { createdAt: sortOrder },
			select: {
				id: true,
				action: true,
				entity: true,
				entityId: true,
				before: true,
				after: true,
				createdAt: true,
				actor: { select: { id: true, name: true, email: true, role: true } },
				subjectMember: {
					select: { id: true, user: { select: { name: true } } },
				},
			},
		}),
		prisma.auditLog.count({ where }),
	]);

	return {
		data: logs,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

const requireFeedMember = async (messId: string, user: RequestUser) => {
	const membership = await loadMessMembership(messId, user);

	if (!membership) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Only A Mess Member Has An Activity Feed",
		);
	}

	return membership;
};

const getUnreadActivity = async (messId: string, user: RequestUser) => {
	const membership = await requireFeedMember(messId, user);

	const member = await prisma.messMember.findUnique({
		where: { id: membership.id },
		select: { feedSeenAt: true },
	});

	const lastSeenAt = member?.feedSeenAt ?? null;

	const unread = await prisma.auditLog.count({
		where: {
			AND: [
				...feedScope(messId, user.role, membership.id),

				{ actorId: { not: user.userId } },
				...(lastSeenAt ? [{ createdAt: { gt: lastSeenAt } }] : []),
			],
		},
	});

	return { unread, lastSeenAt };
};

const markActivitySeen = async (messId: string, user: RequestUser) => {
	const membership = await requireFeedMember(messId, user);

	const member = await prisma.messMember.update({
		where: { id: membership.id },
		data: { feedSeenAt: new Date() },
		select: { feedSeenAt: true },
	});

	return { unread: 0, lastSeenAt: member.feedSeenAt };
};

export const MessServices = {
	createMess,
	getAllMesses,
	getMyMesses,
	getSingleMess,
	getMessAuditLogs,
	getUnreadActivity,
	markActivitySeen,
	updateMess,
	deleteMess,
};
