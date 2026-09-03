import httpStatus from "http-status";
import { CycleStatus, Role } from "../../../generated/prisma/enums";
import type { MealEntryWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IAddDailyMealsPayload,
	IUpdateMealPayload,
} from "./meal.interface";

const mealSelect = {
	id: true,
	date: true,
	lunch: true,
	dinner: true,
	member: {
		select: {
			id: true,
			user: { select: { id: true, name: true, email: true } },
		},
	},
};

// The column is a DATE, and the unique key is (memberId, date). Anything with a
// time component would slip past that constraint and let one day be recorded
// twice, so every date is flattened to UTC midnight before it is used.
const toDateOnly = (date: Date) =>
	new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);

const loadOpenCycle = async (cycleId: string, user: RequestUser) => {
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
			"Only The Mess Manager Can Record Meals",
		);
	}

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Reopen It To Change Meals.",
		);
	}

	return cycle;
};

/**
 * Records one day for the whole mess in a single request.
 *
 * The manager fills the register once a day for everyone, so this takes a date
 * and a list of members rather than one call per person. Every entry is written
 * in one transaction: a half-recorded day would quietly skew the month rate for
 * everyone, since the rate divides the grocery bill by the meal total.
 */
const addDailyMeals = async (
	payload: IAddDailyMealsPayload,
	user: RequestUser,
) => {
	const cycle = await loadOpenCycle(payload.cycleId, user);

	const date = toDateOnly(payload.date);

	// A meal can only belong to the month it was eaten in, otherwise it would be
	// counted against the wrong grocery bill.
	if (
		date.getUTCFullYear() !== cycle.year ||
		date.getUTCMonth() + 1 !== cycle.month
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This Date Is Outside The Cycle For ${cycle.month}/${cycle.year}`,
		);
	}

	const memberIds = payload.entries.map((entry) => entry.memberId);

	const duplicateInRequest = memberIds.length !== new Set(memberIds).size;

	if (duplicateInRequest) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"The Same Member Appears More Than Once In This Request",
		);
	}

	const members = await prisma.messMember.findMany({
		where: { id: { in: memberIds }, messId: cycle.messId, isDeleted: false },
		select: { id: true, joinedAt: true, leftAt: true },
	});

	if (members.length !== memberIds.length) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"One Or More Members Do Not Belong To This Mess",
		);
	}

	// Nobody eats before they move in or after they move out. Without this a
	// stray entry would give someone a share of a month they were not part of.
	for (const member of members) {
		if (toDateOnly(member.joinedAt) > date) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"A Member Cannot Have Meals Before They Joined The Mess",
			);
		}

		if (member.leftAt && toDateOnly(member.leftAt) < date) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"A Member Cannot Have Meals After They Left The Mess",
			);
		}
	}

	return prisma.$transaction(async (tx) => {
		const saved = [];

		for (const entry of payload.entries) {
			// upsert rather than create: re-sending a day is a correction, not a
			// duplicate. A soft-deleted row still holds the unique slot, so the
			// update path also clears the delete flags and restores it.
			const row = await tx.mealEntry.upsert({
				where: { memberId_date: { memberId: entry.memberId, date } },
				create: {
					cycleId: cycle.id,
					memberId: entry.memberId,
					date,
					lunch: entry.lunch,
					dinner: entry.dinner,
				},
				update: {
					cycleId: cycle.id,
					lunch: entry.lunch,
					dinner: entry.dinner,
					isDeleted: false,
					deletedAt: null,
				},
				select: mealSelect,
			});

			saved.push(row);
		}

		return saved;
	});
};

const getCycleMeals = async (
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

	await checkMessAccess(cycle.messId, user);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "date";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: MealEntryWhereInput[] = [{ cycleId, isDeleted: false }];

	// Readable by anyone in the mess. The register is the wall chart: members
	// check it to see the manager recorded them correctly, and whoever is on
	// grocery duty reads it to plan. Filtering it to your own row would make the
	// summary, which already shows everyone, contradict this list.
	if (query.memberId) {
		andConditions.push({ memberId: query.memberId });
	}

	if (query.date) {
		andConditions.push({ date: toDateOnly(new Date(query.date)) });
	}

	if (query.searchTerm) {
		andConditions.push({
			member: {
				user: {
					OR: [
						{ name: { contains: query.searchTerm, mode: "insensitive" } },
						{ email: { contains: query.searchTerm, mode: "insensitive" } },
					],
				},
			},
		});
	}

	const meals = await prisma.mealEntry.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: mealSelect,
	});

	const total = await prisma.mealEntry.count({ where: { AND: andConditions } });

	return {
		data: meals,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

/**
 * The month at a glance: how many meals each member ate, and the running rate.
 *
 * This is the handwritten ledger page the project replaces, so it returns the
 * same three things that page carried - per member totals, the mess total, and
 * what one meal currently costs.
 */
const getMealSummary = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	const [grouped, members, groceryTotal] = await Promise.all([
		prisma.mealEntry.groupBy({
			by: ["memberId"],
			where: { cycleId, isDeleted: false },
			_sum: { lunch: true, dinner: true },
		}),
		prisma.messMember.findMany({
			where: { messId: cycle.messId, isDeleted: false },
			select: {
				id: true,
				status: true,
				user: { select: { id: true, name: true, email: true } },
			},
		}),
		prisma.expense.aggregate({
			where: { cycleId, isDeleted: false, type: "GROCERY" },
			_sum: { amount: true },
		}),
	]);

	const totalsByMember = new Map(
		grouped.map((row) => [
			row.memberId,
			{
				lunch: row._sum.lunch ?? 0,
				dinner: row._sum.dinner ?? 0,
			},
		]),
	);

	// Members with no meals recorded still belong on the page, showing zero.
	// Dropping them would make the register look shorter than the mess.
	const rows = members.map((member) => {
		const totals = totalsByMember.get(member.id) ?? { lunch: 0, dinner: 0 };

		return {
			memberId: member.id,
			name: member.user.name,
			email: member.user.email,
			status: member.status,
			lunch: totals.lunch,
			dinner: totals.dinner,
			totalMeals: totals.lunch + totals.dinner,
		};
	});

	const totalMeals = rows.reduce((sum, row) => sum + row.totalMeals, 0);
	const grocery = Number(groceryTotal._sum.amount ?? 0);

	return {
		cycle: {
			id: cycle.id,
			year: cycle.year,
			month: cycle.month,
			status: cycle.status,
		},
		totalMeals,
		totalGrocery: grocery,
		// Moves with every meal and every grocery slip while the month is open,
		// so it is computed here rather than stored.
		runningMealRate:
			totalMeals > 0 ? Number((grocery / totalMeals).toFixed(4)) : 0,
		members: rows,
	};
};

const updateMeal = async (
	mealId: string,
	payload: IUpdateMealPayload,
	user: RequestUser,
) => {
	const meal = await prisma.mealEntry.findFirst({
		where: { id: mealId, isDeleted: false },
		select: {
			id: true,
			cycleId: true,
			cycle: { select: { status: true, messId: true } },
		},
	});

	if (!meal) {
		throw new AppError(httpStatus.NOT_FOUND, "Meal Entry Not Found");
	}

	await checkMessAccess(meal.cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Change Meals",
		);
	}

	if (meal.cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Reopen It To Change Meals.",
		);
	}

	return prisma.mealEntry.update({
		where: { id: mealId },
		data: { lunch: payload.lunch, dinner: payload.dinner },
		select: mealSelect,
	});
};

const deleteMeal = async (mealId: string, user: RequestUser) => {
	const meal = await prisma.mealEntry.findFirst({
		where: { id: mealId, isDeleted: false },
		select: {
			id: true,
			cycle: { select: { status: true, messId: true } },
		},
	});

	if (!meal) {
		throw new AppError(httpStatus.NOT_FOUND, "Meal Entry Not Found");
	}

	await checkMessAccess(meal.cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Delete Meals",
		);
	}

	if (meal.cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Reopen It To Change Meals.",
		);
	}

	// Soft delete keeps the row, which matters twice over: the register stays
	// auditable, and the unique slot stays taken so re-recording the same day
	// restores this row instead of inserting a second one.
	return prisma.mealEntry.update({
		where: { id: mealId },
		data: { isDeleted: true, deletedAt: new Date() },
		select: { id: true, date: true, isDeleted: true, deletedAt: true },
	});
};

export const MealServices = {
	addDailyMeals,
	getCycleMeals,
	getMealSummary,
	updateMeal,
	deleteMeal,
};
