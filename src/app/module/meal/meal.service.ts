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

const addDailyMeals = async (
	payload: IAddDailyMealsPayload,
	user: RequestUser,
) => {
	const cycle = await loadOpenCycle(payload.cycleId, user);

	const date = toDateOnly(payload.date);

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
