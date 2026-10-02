import httpStatus from "http-status";
import type { Prisma } from "../../../generated/prisma/client";
import {
	AuditAction,
	BillStatus,
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
import { dhakaDateOnly } from "../cron/cron.service";
import { sendBillsWithdrawn, sendCycleBills } from "./cycle.mail";
import {
	computeSettlement,
	depositFundedGroceryWarning,
	type SettlementMember,
	sharesTheMonth,
	uncarriedBill,
} from "./cycle.settlement";
import { buildCycleTrends } from "./cycle.trends";

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

// Cycles of the same mess that come before year/month.
const earlierThan = (year: number, month: number) => [
	{ year: { lt: year } },
	{ year, month: { lt: month } },
];

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

type TSettlementCycle = {
	id: string;
	year: number;
	month: number;
	messId: string;
	monthlyRent: number;
	monthlyDeposit: number;
};

// Reads the cycle's ledger and runs the settlement without writing anything,
// so closing a month and previewing it can never disagree.
const loadSettlement = async (
	db: Prisma.TransactionClient | typeof prisma,
	cycle: TSettlementCycle,
) => {
	const members = await db.messMember.findMany({
		where: {
			messId: cycle.messId,
			isDeleted: false,

			OR: [{ status: MemberStatus.ACTIVE }, { leftAt: { not: null } }],
		},
		select: {
			id: true,
			joinedAt: true,
			leftAt: true,
			user: { select: { name: true, email: true } },
		},
	});

	const [mealTotals, expenses, deposits] = await Promise.all([
		db.mealEntry.groupBy({
			by: ["memberId"],
			where: { cycleId: cycle.id, isDeleted: false },
			_sum: { lunch: true, dinner: true },
		}),
		db.expense.findMany({
			where: { cycleId: cycle.id, isDeleted: false },
			select: {
				type: true,
				amount: true,
				splitMethod: true,
				paidByMemberId: true,
			},
		}),
		db.deposit.groupBy({
			by: ["memberId"],
			where: { cycleId: cycle.id, isDeleted: false },
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
			(paidByMember.get(expense.paidByMemberId) ?? 0) + Number(expense.amount),
		);
	}

	const previousCycle = await db.billingCycle.findFirst({
		where: {
			messId: cycle.messId,
			status: CycleStatus.CLOSED,
			OR: earlierThan(cycle.year, cycle.month),
		},
		orderBy: [{ year: "desc" }, { month: "desc" }],
		select: {
			bills: { select: { id: true, memberId: true, dueAmount: true } },
		},
	});

	const openingByMember = new Map(
		(previousCycle?.bills ?? []).map((bill) => [
			bill.memberId,
			Number(bill.dueAmount),
		]),
	);

	const settlementMembers: SettlementMember[] = members
		.map((member) => ({
			memberId: member.id,
			mealCount: mealByMember.get(member.id) ?? 0,
			depositTotal: depositByMember.get(member.id) ?? 0,
			paidExpenseTotal: paidByMember.get(member.id) ?? 0,
			openingBalance: openingByMember.get(member.id) ?? 0,
			daysPresent: daysPresentInCycle(
				cycle.year,
				cycle.month,
				member.joinedAt,
				member.leftAt,
			),
		}))
		.filter(sharesTheMonth);

	const billed = new Set(settlementMembers.map((member) => member.memberId));

	// Last month's balances that open this month's bills.
	const carriedBillIds = (previousCycle?.bills ?? [])
		.filter((bill) => billed.has(bill.memberId) && Number(bill.dueAmount) !== 0)
		.map((bill) => bill.id);

	const result = computeSettlement({
		members: settlementMembers,
		expenses: expenses.map((e) => ({
			type: e.type,
			amount: Number(e.amount),
			splitMethod: e.splitMethod,
		})),
		monthlyRent: cycle.monthlyRent,
		monthlyDeposit: cycle.monthlyDeposit,
		daysInMonth: daysInMonth(cycle.year, cycle.month),
	});

	const warning = depositFundedGroceryWarning({
		depositTotal: [...depositByMember.values()].reduce(
			(sum, amount) => sum + amount,
			0,
		),
		expenses,
	});

	return {
		members: members.filter((member) => billed.has(member.id)),
		result,
		warnings: warning ? [warning] : [],
		carriedBillIds,
	};
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

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
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

const previewSettlement = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: {
			id: true,
			year: true,
			month: true,
			status: true,
			messId: true,
			mess: { select: { monthlyRent: true, monthlyDeposit: true } },
		},
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	const membership = await checkMessAccess(cycle.messId, user);

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Its Bills Are Final, So There Is Nothing To Preview.",
		);
	}

	const { members, result, warnings } = await loadSettlement(prisma, {
		id: cycle.id,
		year: cycle.year,
		month: cycle.month,
		messId: cycle.messId,
		monthlyRent: Number(cycle.mess.monthlyRent),
		monthlyDeposit: Number(cycle.mess.monthlyDeposit),
	});

	const nameByMember = new Map(members.map((m) => [m.id, m.user.name]));

	const bills = result.bills.map((bill) => ({
		...bill,
		name: nameByMember.get(bill.memberId) ?? null,
	}));

	const isMember = user.role === Role.MEMBER;

	return {
		cycle: {
			id: cycle.id,
			year: cycle.year,
			month: cycle.month,
			status: cycle.status,
		},
		isPreview: true,
		asOf: new Date(),
		totalMeals: result.totalMeals,
		totalGrocery: result.totalGrocery,
		mealRate: result.mealRate,
		bills: isMember
			? bills.filter((bill) => bill.memberId === membership?.id)
			: bills,
		warnings: isMember ? [] : warnings,
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
			mess: {
				select: { name: true, monthlyRent: true, monthlyDeposit: true },
			},
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

	const outcome = await prisma.$transaction(async (tx) => {
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

		const { members, result, warnings, carriedBillIds } = await loadSettlement(
			tx,
			{
				id: cycleId,
				year: cycle.year,
				month: cycle.month,
				messId: cycle.messId,
				monthlyRent: Number(cycle.mess.monthlyRent),
				monthlyDeposit: Number(cycle.mess.monthlyDeposit),
			},
		);

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

		// Their balance now opens this month's bill, so the old bill stops asking for it.
		await tx.memberBill.updateMany({
			where: { id: { in: carriedBillIds } },
			data: { dueAmount: 0, status: BillStatus.CARRIED },
		});

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
			messId: cycle.messId,
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

		return {
			cycle: closed,
			bills: result.bills,
			warnings,
			result,
			recipients: members.map((member) => ({
				memberId: member.id,
				name: member.user.name,
				email: member.user.email,
			})),
		};
	});

	await sendCycleBills({
		cycleId,
		messName: cycle.mess.name,
		year: cycle.year,
		month: cycle.month,
		result: outcome.result,
		recipients: outcome.recipients,
	});

	return {
		cycle: outcome.cycle,
		bills: outcome.bills,
		warnings: outcome.warnings,
	};
};

const reopenCycle = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: {
			id: true,
			status: true,
			messId: true,
			year: true,
			month: true,
			mess: { select: { name: true } },
		},
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	if (cycle.status === CycleStatus.OPEN) {
		throw new AppError(httpStatus.CONFLICT, "This Cycle Is Already Open");
	}

	// A later month opened with this one's balances, so it has to go first.
	const laterClosed = await prisma.billingCycle.findFirst({
		where: {
			messId: cycle.messId,
			status: CycleStatus.CLOSED,
			OR: [
				{ year: { gt: cycle.year } },
				{ year: cycle.year, month: { gt: cycle.month } },
			],
		},
		select: { id: true },
	});

	if (laterClosed) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Reopen The Newest Closed Month First",
		);
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

	const withdrawn = await prisma.memberBill.findMany({
		where: { cycleId },
		select: {
			dueAmount: true,
			member: { select: { user: { select: { name: true, email: true } } } },
		},
	});

	const reopened = await prisma.$transaction(async (tx) => {
		const removed = await tx.memberBill.deleteMany({ where: { cycleId } });

		const previous = await tx.billingCycle.findFirst({
			where: {
				messId: cycle.messId,
				status: CycleStatus.CLOSED,
				OR: earlierThan(cycle.year, cycle.month),
			},
			orderBy: [{ year: "desc" }, { month: "desc" }],
			select: {
				bills: {
					where: { status: BillStatus.CARRIED },
					select: {
						id: true,
						totalPayable: true,
						creditAmount: true,
						paidAmount: true,
					},
				},
			},
		});

		const restored = previous?.bills ?? [];

		for (const bill of restored) {
			await tx.memberBill.update({
				where: { id: bill.id },
				data: uncarriedBill({
					totalPayable: Number(bill.totalPayable),
					creditAmount: Number(bill.creditAmount),
					paidAmount: Number(bill.paidAmount),
				}),
			});
		}

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
			messId: cycle.messId,
			entity: "BillingCycle",
			entityId: cycleId,
			before: { status: CycleStatus.CLOSED },
			after: {
				status: CycleStatus.OPEN,
				billsRemoved: removed.count,
				billsRestored: restored.length,
			},
		});

		return reopened;
	});

	await sendBillsWithdrawn({
		cycleId,
		messName: cycle.mess.name,
		year: cycle.year,
		month: cycle.month,
		withdrawn: withdrawn.map((bill) => ({
			name: bill.member.user.name,
			email: bill.member.user.email,
			previousDue: Number(bill.dueAmount),
		})),
	});

	return reopened;
};

const getCycleTrends = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	const membership = await checkMessAccess(cycle.messId, user);

	// The month so far: from its first day to today, or to its last day.
	const from = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
	const monthEnd = new Date(Date.UTC(cycle.year, cycle.month, 0));
	const today = dhakaDateOnly(new Date());
	const to = today < from ? from : today > monthEnd ? monthEnd : today;

	const [meals, expenses, previous] = await Promise.all([
		prisma.mealEntry.findMany({
			where: { cycleId, isDeleted: false },
			select: { date: true, lunch: true, dinner: true, memberId: true },
		}),
		prisma.expense.findMany({
			where: { cycleId, isDeleted: false },
			select: { spentAt: true, type: true, amount: true },
		}),
		// What last month still owes is the manager's business, not a member's.
		user.role === Role.MEMBER
			? null
			: prisma.billingCycle.findFirst({
					where: {
						messId: cycle.messId,
						status: CycleStatus.CLOSED,
						OR: [
							{ year: { lt: cycle.year } },
							{ year: cycle.year, month: { lt: cycle.month } },
						],
					},
					orderBy: [{ year: "desc" }, { month: "desc" }],
					select: {
						id: true,
						year: true,
						month: true,
						bills: {
							select: {
								createdAt: true,
								totalPayable: true,
								creditAmount: true,
								payments: {
									where: { status: PaymentStatus.PAID },
									select: { amount: true, paidAt: true },
								},
							},
						},
					},
				}),
	]);

	const trends = buildCycleTrends({
		from,
		to,
		meals,
		expenses: expenses.map((expense) => ({
			spentAt: expense.spentAt,
			type: expense.type,
			amount: Number(expense.amount),
		})),
		memberId: membership?.id ?? null,
		previousBills: previous
			? previous.bills.map((bill) => ({
					createdAt: bill.createdAt,
					totalPayable: Number(bill.totalPayable),
					creditAmount: Number(bill.creditAmount),
					payments: bill.payments.map((payment) => ({
						amount: Number(payment.amount),
						paidAt: payment.paidAt,
					})),
				}))
			: null,
	});

	return {
		cycle: { id: cycle.id, year: cycle.year, month: cycle.month },
		previousCycle: previous
			? { id: previous.id, year: previous.year, month: previous.month }
			: null,
		...trends,
	};
};

export const CycleServices = {
	openCycle,
	getMessCycles,
	getSingleCycle,
	previewSettlement,
	closeCycle,
	reopenCycle,
	getCycleTrends,
};
