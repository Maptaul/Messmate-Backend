import httpStatus from "http-status";
import {
	AuditAction,
	CycleStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { ExpenseWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import {
	destroyFromCloudinary,
	uploadToCloudinary,
} from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IAddExpensePayload,
	IUpdateExpensePayload,
} from "./expense.interface";

const expenseSelect = {
	id: true,
	type: true,
	amount: true,
	splitMethod: true,
	description: true,
	spentAt: true,
	receiptUrl: true,
	createdAt: true,
	paidByMember: {
		select: {
			id: true,
			user: { select: { id: true, name: true } },
		},
	},
	createdBy: { select: { id: true, name: true } },
};

const toDateOnly = (date: Date) =>
	new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);

/**
 * Loads the cycle and refuses anything that would change a settled month.
 *
 * Every expense feeds the settlement: GROCERY sets the meal rate, the utility
 * types are split across members, and whoever paid gets credited. Letting one
 * change after close would leave bills that no longer match their own inputs.
 */
const loadWritableCycle = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Record Expenses",
		);
	}

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Reopen It To Change Expenses.",
		);
	}

	return cycle;
};

const addExpense = async (
	payload: IAddExpensePayload,
	receipt: Express.Multer.File | undefined,
	user: RequestUser,
) => {
	const cycle = await loadWritableCycle(payload.cycleId, user);

	const spentAt = toDateOnly(payload.spentAt);

	// An expense belongs to the month it was spent in, or it would be divided
	// among the wrong people against the wrong meal total.
	if (
		spentAt.getUTCFullYear() !== cycle.year ||
		spentAt.getUTCMonth() + 1 !== cycle.month
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This Date Is Outside The Cycle For ${cycle.month}/${cycle.year}`,
		);
	}

	if (payload.paidByMemberId) {
		const payer = await prisma.messMember.findFirst({
			where: {
				id: payload.paidByMemberId,
				messId: cycle.messId,
				isDeleted: false,
			},
			select: { id: true },
		});

		if (!payer) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"The Paying Member Does Not Belong To This Mess",
			);
		}
	}

	// Optional. Most expenses are entered from memory with no slip to photograph,
	// so a missing receipt is normal rather than an error.
	const upload = receipt
		? await uploadToCloudinary(receipt, "receipts")
		: null;

	return prisma.expense.create({
		data: {
			cycleId: cycle.id,
			type: payload.type,
			amount: payload.amount,
			splitMethod: payload.splitMethod ?? "EQUAL",
			paidByMemberId: payload.paidByMemberId ?? null,
			description: payload.description ?? null,
			spentAt,
			receiptUrl: upload?.secure_url ?? null,
			receiptPublicId: upload?.public_id ?? null,
			createdById: user.userId,
		},
		select: expenseSelect,
	});
};

const getCycleExpenses = async (
	cycleId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	// Readable by everyone in the mess. These are the numbers each member is
	// about to be billed from, so being able to check them is the point.
	await checkMessAccess(cycle.messId, user);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "spentAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: ExpenseWhereInput[] = [{ cycleId, isDeleted: false }];

	if (query.type) {
		andConditions.push({ type: query.type });
	}

	if (query.paidByMemberId) {
		andConditions.push({ paidByMemberId: query.paidByMemberId });
	}

	if (query.searchTerm) {
		andConditions.push({
			description: { contains: query.searchTerm, mode: "insensitive" },
		});
	}

	const expenses = await prisma.expense.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: expenseSelect,
	});

	const total = await prisma.expense.count({ where: { AND: andConditions } });

	return {
		data: expenses,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

/**
 * The spending side of the ledger page: what went out this month, grouped the
 * way the settlement will use it.
 *
 * GROCERY is reported on its own because it is the only type that sets the meal
 * rate. The rest are shared costs, and RENT is separate again because it is
 * prorated by tenure rather than split.
 */
const getExpenseSummary = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	const [byType, byPayer, mealTotals] = await Promise.all([
		prisma.expense.groupBy({
			by: ["type"],
			where: { cycleId, isDeleted: false },
			_sum: { amount: true },
			_count: { _all: true },
		}),
		prisma.expense.groupBy({
			by: ["paidByMemberId"],
			where: { cycleId, isDeleted: false, paidByMemberId: { not: null } },
			_sum: { amount: true },
		}),
		prisma.mealEntry.aggregate({
			where: { cycleId, isDeleted: false },
			_sum: { lunch: true, dinner: true },
		}),
	]);

	const payerIds = byPayer
		.map((row) => row.paidByMemberId)
		.filter((id): id is string => Boolean(id));

	const payers = await prisma.messMember.findMany({
		where: { id: { in: payerIds } },
		select: { id: true, user: { select: { name: true } } },
	});

	const payerNames = new Map(payers.map((p) => [p.id, p.user.name]));

	const amountOf = (type: string) =>
		Number(byType.find((row) => row.type === type)?._sum.amount ?? 0);

	const grocery = amountOf("GROCERY");
	const rent = amountOf("RENT");
	const grandTotal = byType.reduce(
		(sum, row) => sum + Number(row._sum.amount ?? 0),
		0,
	);

	const totalMeals =
		(mealTotals._sum.lunch ?? 0) + (mealTotals._sum.dinner ?? 0);

	return {
		cycle: {
			id: cycle.id,
			year: cycle.year,
			month: cycle.month,
			status: cycle.status,
		},
		grandTotal,
		grocery,
		rent,
		// What gets split across members: everything that is neither the grocery
		// bill nor the rent.
		sharedTotal: grandTotal - grocery - rent,
		totalMeals,
		runningMealRate:
			totalMeals > 0 ? Number((grocery / totalMeals).toFixed(4)) : 0,
		byType: byType.map((row) => ({
			type: row.type,
			total: Number(row._sum.amount ?? 0),
			count: row._count._all,
		})),
		// Who is owed money back. This becomes their credit at settlement.
		paidByMembers: byPayer.map((row) => ({
			memberId: row.paidByMemberId,
			name: payerNames.get(row.paidByMemberId as string) ?? null,
			total: Number(row._sum.amount ?? 0),
		})),
	};
};

const updateExpense = async (
	expenseId: string,
	payload: IUpdateExpensePayload,
	receipt: Express.Multer.File | undefined,
	user: RequestUser,
) => {
	const expense = await prisma.expense.findFirst({
		where: { id: expenseId, isDeleted: false },
		select: {
			id: true,
			cycleId: true,
			receiptPublicId: true,
			cycle: { select: { year: true, month: true } },
		},
	});

	if (!expense) {
		throw new AppError(httpStatus.NOT_FOUND, "Expense Not Found");
	}

	const cycle = await loadWritableCycle(expense.cycleId, user);

	const spentAt = payload.spentAt ? toDateOnly(payload.spentAt) : undefined;

	if (
		spentAt &&
		(spentAt.getUTCFullYear() !== cycle.year ||
			spentAt.getUTCMonth() + 1 !== cycle.month)
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This Date Is Outside The Cycle For ${cycle.month}/${cycle.year}`,
		);
	}

	if (payload.paidByMemberId) {
		const payer = await prisma.messMember.findFirst({
			where: {
				id: payload.paidByMemberId,
				messId: cycle.messId,
				isDeleted: false,
			},
			select: { id: true },
		});

		if (!payer) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"The Paying Member Does Not Belong To This Mess",
			);
		}
	}

	const upload = receipt
		? await uploadToCloudinary(receipt, "receipts")
		: null;

	const updated = await prisma.expense.update({
		where: { id: expenseId },
		data: {
			type: payload.type,
			amount: payload.amount,
			splitMethod: payload.splitMethod,
			paidByMemberId: payload.paidByMemberId,
			description: payload.description,
			spentAt,
			...(upload
				? { receiptUrl: upload.secure_url, receiptPublicId: upload.public_id }
				: {}),
		},
		select: expenseSelect,
	});

	// Only after the replacement is safely stored, so a failed upload cannot
	// leave the expense with no receipt at all.
	if (upload && expense.receiptPublicId) {
		await destroyFromCloudinary(expense.receiptPublicId);
	}

	return updated;
};

const deleteExpense = async (expenseId: string, user: RequestUser) => {
	const expense = await prisma.expense.findFirst({
		where: { id: expenseId, isDeleted: false },
		select: {
			id: true,
			cycleId: true,
			type: true,
			amount: true,
			description: true,
		},
	});

	if (!expense) {
		throw new AppError(httpStatus.NOT_FOUND, "Expense Not Found");
	}

	await loadWritableCycle(expense.cycleId, user);

	// Audited, because removing an expense changes what every member in the mess
	// owes - the grocery bill sets the meal rate and the rest is split.
	return prisma.$transaction(async (tx) => {
		const removed = await tx.expense.update({
			where: { id: expenseId },
			data: { isDeleted: true, deletedAt: new Date() },
			select: {
				id: true,
				type: true,
				amount: true,
				isDeleted: true,
				deletedAt: true,
			},
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.EXPENSE_DELETED,
			entity: "Expense",
			entityId: expenseId,
			before: {
				type: expense.type,
				amount: Number(expense.amount),
				description: expense.description,
			},
			after: { isDeleted: true },
		});

		return removed;
	});
};

export const ExpenseServices = {
	addExpense,
	getCycleExpenses,
	getExpenseSummary,
	updateExpense,
	deleteExpense,
};
