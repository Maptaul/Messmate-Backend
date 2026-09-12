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
};

const createMess = async (payload: ICreateMessPayload, user: RequestUser) => {
	const isNameTaken = await prisma.mess.findFirst({
		where: {
			name: payload.name,
			managerId: user.userId,
			isDeleted: false,
		},
	});

	if (isNameTaken) {
		throw new AppError(
			httpStatus.CONFLICT,
			"You Already Manage A Mess With This Name",
		);
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

const getMessAuditLogs = async (
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

	const membership = await checkMessAccess(messId, user);

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: AuditLogWhereInput[] = [{ messId }];

	if (user.role === Role.MEMBER) {
		andConditions.push({ subjectMemberId: membership?.id ?? "" });
	} else if (query.memberId) {
		andConditions.push({ subjectMemberId: query.memberId });
	}

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

export const MessServices = {
	createMess,
	getAllMesses,
	getMyMesses,
	getSingleMess,
	getMessAuditLogs,
	updateMess,
	deleteMess,
};
