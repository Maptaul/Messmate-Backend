import httpStatus from "http-status";
import {
	AuditAction,
	CycleStatus,
	MemberStatus,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { BillingCycleWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type { IOpenCyclePayload } from "./cycle.interface";
import { computeSettlement, type SettlementMember } from "./cycle.settlement";

const cycleSelect = {
	id: true,
	year: true,
	month: true,
	status: true,
	totalMeals: true,
	totalGrocery: true,
	mealRate: true,
	closedAt: true,
	createdAt: true,
	mess: { select: { id: true, name: true, monthlyRent: true } },
	closedBy: { select: { id: true, name: true } },
};

const daysInMonth = (year: number, month: number) =>
	new Date(year, month, 0).getDate();

const daysPresentInCycle = (
	year: number,
	month: number,
	joinedAt: Date,
	leftAt: Date | null,
) => {
	const monthStart = new Date(Date.UTC(year, month - 1, 1));
	const monthEnd = new Date(Date.UTC(year, month, 0));

	const from = joinedAt > monthStart ? joinedAt : monthStart;
	const to = leftAt && leftAt < monthEnd ? leftAt : monthEnd;

	if (to < from) {
		return 0;
	}

	const dayMs = 1000 * 60 * 60 * 24;
	return Math.floor((to.getTime() - from.getTime()) / dayMs) + 1;
};

const openCycle = async (payload: IOpenCyclePayload, user: RequestUser) => {
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
			"Only The Mess Manager Can Open A Billing Cycle",
		);
	}

	const openCycleExists = await prisma.billingCycle.findFirst({
		where: { messId: payload.messId, status: CycleStatus.OPEN },
		select: { year: true, month: true },
	});

	if (openCycleExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			`The Cycle For ${openCycleExists.month}/${openCycleExists.year} Is Still Open. Close It First.`,
		);
	}

	const alreadyExists = await prisma.billingCycle.findUnique({
		where: {
			messId_year_month: {
				messId: payload.messId,
				year: payload.year,
				month: payload.month,
			},
		},
		select: { id: true, status: true },
	});

	if (alreadyExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"A Billing Cycle For This Month Already Exists",
		);
	}

	return prisma.billingCycle.create({
		data: {
			messId: payload.messId,
			year: payload.year,
			month: payload.month,
			status: CycleStatus.OPEN,
		},
		select: cycleSelect,
	});
};

const getMessCycles = async (
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

	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: BillingCycleWhereInput[] = [{ messId }];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	if (query.year) {
		andConditions.push({ year: Number(query.year) });
	}

	const cycles = await prisma.billingCycle.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: [{ year: sortOrder }, { month: sortOrder }],
		select: cycleSelect,
	});

	const total = await prisma.billingCycle.count({
		where: { AND: andConditions },
	});

	return {
		data: cycles,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const getSingleCycle = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: {
			...cycleSelect,
			_count: {
				select: { meals: true, expenses: true, deposits: true, bills: true },
			},
		},
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.mess.id, user);

	const mealTotals = await prisma.mealEntry.aggregate({
		where: { cycleId, isDeleted: false },
		_sum: { lunch: true, dinner: true },
	});

	const expenseTotals = await prisma.expense.groupBy({
		by: ["type"],
		where: { cycleId, isDeleted: false },
		_sum: { amount: true },
	});

	const groceryTotal = expenseTotals
		.filter((row) => row.type === "GROCERY")
		.reduce((sum, row) => sum + Number(row._sum.amount ?? 0), 0);

	const runningMeals =
		(mealTotals._sum.lunch ?? 0) + (mealTotals._sum.dinner ?? 0);

	return {
		...cycle,
		summary: {
			totalMeals: runningMeals,
			totalGrocery: groceryTotal,
			runningMealRate:
				runningMeals > 0 ? Number((groceryTotal / runningMeals).toFixed(4)) : 0,
			expenseByType: expenseTotals.map((row) => ({
				type: row.type,
				total: Number(row._sum.amount ?? 0),
			})),
		},
	};
};

const closeCycle = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: {
			id: true,
			year: true,
			month: true,
			status: true,
			messId: true,
			mess: { select: { monthlyRent: true } },
		},
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Close A Billing Cycle",
		);
	}

	return prisma.$transaction(async (tx) => {
		const claimed = await tx.billingCycle.updateMany({
			where: { id: cycleId, status: CycleStatus.OPEN },
			data: {
				status: CycleStatus.CLOSED,
				closedAt: new Date(),
				closedById: user.userId,
			},
		});

		if (claimed.count === 0) {
			throw new AppError(httpStatus.CONFLICT, "This Cycle Is Already Closed");
		}

		const members = await tx.messMember.findMany({
			where: {
				messId: cycle.messId,
				isDeleted: false,

				OR: [{ status: MemberStatus.ACTIVE }, { leftAt: { not: null } }],
			},
			select: { id: true, joinedAt: true, leftAt: true },
		});

		const [mealTotals, expenses, deposits] = await Promise.all([
			tx.mealEntry.groupBy({
				by: ["memberId"],
				where: { cycleId, isDeleted: false },
				_sum: { lunch: true, dinner: true },
			}),
			tx.expense.findMany({
				where: { cycleId, isDeleted: false },
				select: {
					type: true,
					amount: true,
					splitMethod: true,
					paidByMemberId: true,
				},
			}),
			tx.deposit.groupBy({
				by: ["memberId"],
				where: { cycleId, isDeleted: false },
				_sum: { amount: true },
			}),
		]);

		const mealByMember = new Map(
			mealTotals.map((row) => [
				row.memberId,
				(row._sum.lunch ?? 0) + (row._sum.dinner ?? 0),
			]),
		);

		const depositByMember = new Map(
			deposits.map((row) => [row.memberId, Number(row._sum.amount ?? 0)]),
		);

		const paidByMember = new Map<string, number>();
		for (const expense of expenses) {
			if (!expense.paidByMemberId) continue;
			paidByMember.set(
				expense.paidByMemberId,
				(paidByMember.get(expense.paidByMemberId) ?? 0) +
					Number(expense.amount),
			);
		}

		const settlementMembers: SettlementMember[] = members.map((member) => ({
			memberId: member.id,
			mealCount: mealByMember.get(member.id) ?? 0,
			depositTotal: depositByMember.get(member.id) ?? 0,
			paidExpenseTotal: paidByMember.get(member.id) ?? 0,
			daysPresent: daysPresentInCycle(
				cycle.year,
				cycle.month,
				member.joinedAt,
				member.leftAt,
			),
		}));

		const result = computeSettlement({
			members: settlementMembers,
			expenses: expenses.map((e) => ({
				type: e.type,
				amount: Number(e.amount),
				splitMethod: e.splitMethod,
			})),
			monthlyRent: Number(cycle.mess.monthlyRent),
			daysInMonth: daysInMonth(cycle.year, cycle.month),
		});

		if (result.bills.length > 0) {
			await tx.memberBill.createMany({
				data: result.bills.map((bill) => ({
					cycleId,
					memberId: bill.memberId,
					mealCount: bill.mealCount,
					mealCost: bill.mealCost,
					sharedCost: bill.sharedCost,
					rentShare: bill.rentShare,
					totalPayable: bill.totalPayable,
					creditAmount: bill.creditAmount,
					dueAmount: bill.dueAmount,
				})),
			});
		}

		const closed = await tx.billingCycle.update({
			where: { id: cycleId },
			data: {
				totalMeals: result.totalMeals,
				totalGrocery: result.totalGrocery,
				mealRate: result.mealRate,
			},
			select: cycleSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.CYCLE_CLOSED,
			entity: "BillingCycle",
			entityId: cycleId,
			before: { status: CycleStatus.OPEN },
			after: {
				status: CycleStatus.CLOSED,
				totalMeals: result.totalMeals,
				mealRate: result.mealRate,
				billsCreated: result.bills.length,
			},
		});

		return { cycle: closed, bills: result.bills };
	});
};

const reopenCycle = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	if (cycle.status === CycleStatus.OPEN) {
		throw new AppError(httpStatus.CONFLICT, "This Cycle Is Already Open");
	}

	const paidBill = await prisma.memberBill.findFirst({
		where: {
			cycleId,
			OR: [
				{ paidAmount: { gt: 0 } },
				{ payments: { some: { status: PaymentStatus.PAID } } },
			],
		},
		select: { id: true },
	});

	if (paidBill) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Has Payments Against It And Can No Longer Be Reopened",
		);
	}

	const otherOpenCycle = await prisma.billingCycle.findFirst({
		where: { messId: cycle.messId, status: CycleStatus.OPEN },
		select: { year: true, month: true },
	});

	if (otherOpenCycle) {
		throw new AppError(
			httpStatus.CONFLICT,
			`The Cycle For ${otherOpenCycle.month}/${otherOpenCycle.year} Is Open. Close It Before Reopening Another.`,
		);
	}

	return prisma.$transaction(async (tx) => {
		const removed = await tx.memberBill.deleteMany({ where: { cycleId } });

		const reopened = await tx.billingCycle.update({
			where: { id: cycleId },
			data: {
				status: CycleStatus.OPEN,
				closedAt: null,
				closedById: null,
				totalMeals: null,
				totalGrocery: null,
				mealRate: null,
			},
			select: cycleSelect,
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.CYCLE_REOPENED,
			entity: "BillingCycle",
			entityId: cycleId,
			before: { status: CycleStatus.CLOSED },
			after: { status: CycleStatus.OPEN, billsRemoved: removed.count },
		});

		return reopened;
	});
};

export const CycleServices = {
	openCycle,
	getMessCycles,
	getSingleCycle,
	closeCycle,
	reopenCycle,
};
