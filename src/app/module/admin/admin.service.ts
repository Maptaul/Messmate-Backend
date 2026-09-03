import httpStatus from "http-status";
import {
	AuditAction,
	BillStatus,
	CycleStatus,
	MemberStatus,
	PaymentStatus,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import type {
	AuditLogWhereInput,
	UserWhereInput,
} from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import type {
	IChangeRolePayload,
	IChangeStatusPayload,
} from "./admin.interface";

const userSelect = {
	id: true,
	name: true,
	email: true,
	phone: true,
	role: true,
	status: true,
	emailVerified: true,
	authProvider: true,
	avatarUrl: true,
	isDeleted: true,
	createdAt: true,
};

const getAllUsers = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: UserWhereInput[] = [{ isDeleted: false }];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ email: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.role) {
		andConditions.push({ role: query.role as Role });
	}

	if (query.status) {
		andConditions.push({ status: query.status as UserStatus });
	}

	const users = await prisma.user.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: userSelect,
	});

	const total = await prisma.user.count({ where: { AND: andConditions } });

	return {
		data: users,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

/**
 * One user with the messes they touch, because that is what an admin needs
 * before changing anything about them - a manager with an open month and a
 * member with an unpaid bill are not the same person to act on.
 */
const getSingleUser = async (userId: string) => {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			...userSelect,
			managedMesses: {
				where: { isDeleted: false },
				select: { id: true, name: true },
			},
			memberships: {
				where: { isDeleted: false },
				select: {
					id: true,
					status: true,
					joinedAt: true,
					mess: { select: { id: true, name: true } },
				},
			},
		},
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	return user;
};

/**
 * Loads the target and refuses the two things an admin should never be able to
 * do to themselves: lock themselves out, or remove the last way back in.
 */
const loadTargetUser = async (userId: string, user: RequestUser) => {
	if (userId === user.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"An Admin Cannot Change Their Own Role Or Status",
		);
	}

	const target = await prisma.user.findFirst({
		where: { id: userId, isDeleted: false },
		select: { id: true, name: true, email: true, role: true, status: true },
	});

	if (!target) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	return target;
};

const changeUserRole = async (
	userId: string,
	payload: IChangeRolePayload,
	user: RequestUser,
) => {
	const target = await loadTargetUser(userId, user);

	if (target.role === payload.role) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This User Is Already A ${payload.role}`,
		);
	}

	// No "last admin" check here on purpose: this route is ADMIN-only and the
	// caller cannot be the target, so an admin acting on another admin is always
	// one that survives. The platform can never be left with none.

	// A manager demoted out of MESS_MANAGER keeps owning the mess row but loses
	// every route that maintains it - the month could no longer be closed and the
	// ledger would sit there unfinishable. Hand the mess over first.
	if (target.role === Role.MESS_MANAGER && payload.role !== Role.MESS_MANAGER) {
		const managedMess = await prisma.mess.findFirst({
			where: { managerId: userId, isDeleted: false },
			select: { name: true },
		});

		if (managedMess) {
			throw new AppError(
				httpStatus.CONFLICT,
				`This User Still Manages "${managedMess.name}". Reassign Or Delete That Mess First.`,
			);
		}
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.user.update({
			where: { id: userId },
			data: { role: payload.role },
			select: userSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.USER_ROLE_CHANGED,
			entity: "User",
			entityId: userId,
			before: { role: target.role },
			after: { role: payload.role },
		});

		return updated;
	});
};

const changeUserStatus = async (
	userId: string,
	payload: IChangeStatusPayload,
	user: RequestUser,
) => {
	const target = await loadTargetUser(userId, user);

	if (target.status === payload.status) {
		throw new AppError(
			httpStatus.CONFLICT,
			`This User Is Already ${payload.status}`,
		);
	}

	// Blocking a manager mid-month strands their mess: nobody else can record the
	// meals or close the cycle, and the members cannot be billed. Wait for the
	// month to close, or hand the mess over.
	if (
		payload.status === UserStatus.BLOCKED &&
		target.role === Role.MESS_MANAGER
	) {
		const openCycle = await prisma.billingCycle.findFirst({
			where: {
				status: CycleStatus.OPEN,
				mess: { managerId: userId, isDeleted: false },
			},
			select: { year: true, month: true, mess: { select: { name: true } } },
		});

		if (openCycle) {
			throw new AppError(
				httpStatus.CONFLICT,
				`"${openCycle.mess.name}" Has An Open Cycle For ${openCycle.month}/${openCycle.year}. Close It Before Blocking Its Manager.`,
			);
		}
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.user.update({
			where: { id: userId },
			data: { status: payload.status },
			select: userSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action:
				payload.status === UserStatus.BLOCKED
					? AuditAction.USER_BLOCKED
					: AuditAction.USER_UNBLOCKED,
			entity: "User",
			entityId: userId,
			before: { status: target.status },
			after: { status: payload.status },
		});

		return updated;
	});
};

/**
 * The trail read back. Everything money- or permission-shaped is written here as
 * it happens; without a way to read it the log is only half a feature.
 */
const getAuditLogs = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: AuditLogWhereInput[] = [];

	if (query.action) {
		andConditions.push({ action: query.action as AuditAction });
	}

	if (query.entity) {
		andConditions.push({ entity: query.entity });
	}

	if (query.entityId) {
		andConditions.push({ entityId: query.entityId });
	}

	if (query.actorId) {
		andConditions.push({ actorId: query.actorId });
	}

	const logs = await prisma.auditLog.findMany({
		where: { AND: andConditions },
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
		},
	});

	const total = await prisma.auditLog.count({ where: { AND: andConditions } });

	return {
		data: logs,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

/**
 * Platform health in one call. Every figure is a count or a sum the database
 * already has an index for, and they run together rather than in sequence -
 * a dashboard that takes eight round trips is a dashboard nobody opens.
 */
const getDashboardStats = async () => {
	const [
		usersByRole,
		blockedUsers,
		messCount,
		activeMembers,
		cyclesByStatus,
		depositTotal,
		expenseTotal,
		settledTotal,
		outstanding,
		recentAudits,
	] = await Promise.all([
		prisma.user.groupBy({
			by: ["role"],
			where: { isDeleted: false },
			_count: { _all: true },
		}),
		prisma.user.count({
			where: { status: UserStatus.BLOCKED, isDeleted: false },
		}),
		prisma.mess.count({ where: { isDeleted: false } }),
		prisma.messMember.count({
			where: { status: MemberStatus.ACTIVE, isDeleted: false },
		}),
		prisma.billingCycle.groupBy({
			by: ["status"],
			_count: { _all: true },
		}),
		prisma.deposit.aggregate({
			where: { isDeleted: false },
			_sum: { amount: true },
		}),
		prisma.expense.aggregate({
			where: { isDeleted: false },
			_sum: { amount: true },
		}),
		prisma.payment.aggregate({
			where: { status: PaymentStatus.PAID },
			_sum: { amount: true },
		}),
		prisma.memberBill.aggregate({
			where: {
				status: { in: [BillStatus.UNPAID, BillStatus.PARTIAL] },
				dueAmount: { gt: 0 },
			},
			_sum: { dueAmount: true },
		}),
		prisma.auditLog.count(),
	]);

	const countFor = (role: Role) =>
		usersByRole.find((row) => row.role === role)?._count._all ?? 0;

	const cycleCountFor = (status: CycleStatus) =>
		cyclesByStatus.find((row) => row.status === status)?._count._all ?? 0;

	return {
		users: {
			total: usersByRole.reduce((sum, row) => sum + row._count._all, 0),
			admins: countFor(Role.ADMIN),
			managers: countFor(Role.MESS_MANAGER),
			members: countFor(Role.MEMBER),
			blocked: blockedUsers,
		},
		messes: {
			total: messCount,
			activeMemberships: activeMembers,
		},
		cycles: {
			open: cycleCountFor(CycleStatus.OPEN),
			closed: cycleCountFor(CycleStatus.CLOSED),
		},
		money: {
			deposits: Number(depositTotal._sum.amount ?? 0),
			expenses: Number(expenseTotal._sum.amount ?? 0),
			settledPayments: Number(settledTotal._sum.amount ?? 0),
			outstandingDue: Number(outstanding._sum.dueAmount ?? 0),
		},
		auditLogEntries: recentAudits,
	};
};

export const AdminServices = {
	getAllUsers,
	getSingleUser,
	changeUserRole,
	changeUserStatus,
	getAuditLogs,
	getDashboardStats,
};
