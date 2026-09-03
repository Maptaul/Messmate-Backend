import httpStatus from "http-status";
import {
	CycleStatus,
	MemberStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { MessWhereInput } from "../../../generated/prisma/models";
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

	// The manager lives in the mess too, so the mess row and their own membership
	// are created together. A mess whose manager is not a member would silently
	// drop them from every settlement.
	const mess = await prisma.$transaction(async (tx) => {
		const createdMess = await tx.mess.create({
			data: {
				name: payload.name,
				address: payload.address,
				monthlyRent: payload.monthlyRent,
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
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
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
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: MessWhereInput[] = [{ isDeleted: false }];

	// A manager sees what they run; a member sees where they live.
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

	// A member of the mess passes checkMessAccess but must not be able to edit it.
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

	// Deleting a mess with a month still open would strand every meal and expense
	// recorded in it, so the month has to be closed first.
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

export const MessServices = {
	createMess,
	getAllMesses,
	getMyMesses,
	getSingleMess,
	updateMess,
	deleteMess,
};
