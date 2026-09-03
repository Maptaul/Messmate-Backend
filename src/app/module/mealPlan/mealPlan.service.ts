import httpStatus from "http-status";
import { CycleStatus, Role } from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { cached, cacheKeys, invalidateCache } from "../../utils/cache";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IApplyPlanPayload,
	ISetMealPlanPayload,
} from "./mealPlan.interface";

const DHAKA_UTC_OFFSET_HOURS = 6;

const CUTOFF_HOUR_LOCAL = 23;

const toDateOnly = (date: Date) =>
	new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);

const planDeadlineFor = (date: Date) => {
	const day = toDateOnly(date);

	return new Date(
		Date.UTC(
			day.getUTCFullYear(),
			day.getUTCMonth(),
			day.getUTCDate() - 1,
			CUTOFF_HOUR_LOCAL - DHAKA_UTC_OFFSET_HOURS,
		),
	);
};

const formatDeadline = (deadline: Date) => {
	const local = new Date(
		deadline.getTime() + DHAKA_UTC_OFFSET_HOURS * 60 * 60 * 1000,
	);

	return `${local.toISOString().slice(0, 10)} ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
};

const planSelect = {
	id: true,
	date: true,
	lunch: true,
	dinner: true,
	updatedAt: true,
	member: {
		select: {
			id: true,
			user: { select: { id: true, name: true, email: true } },
		},
	},
};

const loadCycle = async (cycleId: string) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	return cycle;
};

const setMealPlan = async (payload: ISetMealPlanPayload, user: RequestUser) => {
	const cycle = await loadCycle(payload.cycleId);

	const membership = await checkMessAccess(cycle.messId, user);

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Meals Can No Longer Be Planned For It.",
		);
	}

	let memberId: string;

	if (user.role === Role.MEMBER) {
		if (!membership) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not A Member Of This Mess",
			);
		}

		if (payload.memberId && payload.memberId !== membership.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Can Only Plan Your Own Meals",
			);
		}

		memberId = membership.id;
	} else if (payload.memberId) {
		memberId = payload.memberId;
	} else if (membership) {
		memberId = membership.id;
	} else {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Member Id Is Required When You Are Not A Member Of This Mess",
		);
	}

	const member = await prisma.messMember.findFirst({
		where: { id: memberId, messId: cycle.messId, isDeleted: false },
		select: { id: true, joinedAt: true, leftAt: true },
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"This Member Does Not Belong To This Mess",
		);
	}

	const now = new Date();
	const seen = new Set<string>();

	for (const day of payload.days) {
		const date = toDateOnly(day.date);
		const key = date.toISOString();

		if (seen.has(key)) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"The Same Date Appears More Than Once In This Request",
			);
		}
		seen.add(key);

		if (
			date.getUTCFullYear() !== cycle.year ||
			date.getUTCMonth() + 1 !== cycle.month
		) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`This Date Is Outside The Cycle For ${cycle.month}/${cycle.year}`,
			);
		}

		if (toDateOnly(member.joinedAt) > date) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"A Member Cannot Plan Meals Before They Joined The Mess",
			);
		}

		if (member.leftAt && toDateOnly(member.leftAt) < date) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"A Member Cannot Plan Meals After They Left The Mess",
			);
		}

		const deadline = planDeadlineFor(date);

		if (now >= deadline) {
			throw new AppError(
				httpStatus.CONFLICT,
				`Too Late For ${date.toISOString().slice(0, 10)}. Plans For That Day Closed At ${formatDeadline(deadline)}.`,
			);
		}
	}

	const saved = await prisma.$transaction(async (tx) => {
		const rows = [];

		for (const day of payload.days) {
			const date = toDateOnly(day.date);

			const row = await tx.mealPlan.upsert({
				where: { memberId_date: { memberId, date } },
				create: {
					cycleId: cycle.id,
					memberId,
					date,
					lunch: day.lunch,
					dinner: day.dinner,
				},

				update: { lunch: day.lunch, dinner: day.dinner },
				select: planSelect,
			});

			rows.push(row);
		}

		return rows;
	});

	await invalidateCache(cacheKeys.mealPlanCalendar(cycle.id));

	return saved;
};

const getMyCalendar = async (cycleId: string, user: RequestUser) => {
	const cycle = await loadCycle(cycleId);

	const membership = await checkMessAccess(cycle.messId, user);

	if (!membership) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Only A Mess Member Has A Personal Meal Calendar",
		);
	}

	const plans = await prisma.mealPlan.findMany({
		where: { cycleId, memberId: membership.id },
		orderBy: { date: "asc" },
		select: {
			id: true,
			date: true,
			lunch: true,
			dinner: true,
			updatedAt: true,
		},
	});

	const planByDate = new Map(
		plans.map((plan) => [plan.date.toISOString().slice(0, 10), plan]),
	);

	const now = new Date();
	const totalDays = new Date(Date.UTC(cycle.year, cycle.month, 0)).getUTCDate();

	const days = Array.from({ length: totalDays }, (_, index) => {
		const date = new Date(Date.UTC(cycle.year, cycle.month - 1, index + 1));
		const key = date.toISOString().slice(0, 10);
		const plan = planByDate.get(key);
		const deadline = planDeadlineFor(date);

		return {
			date: key,
			lunch: plan?.lunch ?? 0,
			dinner: plan?.dinner ?? 0,
			isPlanned: Boolean(plan),
			isLocked: now >= deadline,
			deadline: formatDeadline(deadline),
		};
	});

	return {
		cycle: {
			id: cycle.id,
			year: cycle.year,
			month: cycle.month,
			status: cycle.status,
		},
		memberId: membership.id,
		plannedMeals: days.reduce((sum, day) => sum + day.lunch + day.dinner, 0),
		days,
	};
};

const CALENDAR_CACHE_SECONDS = 300;

type TPlanDay = {
	date: string;
	lunch: number;
	dinner: number;
	members: { memberId: string; name: string; lunch: number; dinner: number }[];
};

const buildPlanDays = async (
	cycleId: string,
	date?: Date,
): Promise<TPlanDay[]> => {
	const plans = await prisma.mealPlan.findMany({
		where: date ? { cycleId, date } : { cycleId },
		orderBy: [{ date: "asc" }],
		select: planSelect,
	});

	const byDate = new Map<string, TPlanDay>();

	for (const plan of plans) {
		const key = plan.date.toISOString().slice(0, 10);

		if (!byDate.has(key)) {
			byDate.set(key, { date: key, lunch: 0, dinner: 0, members: [] });
		}

		const row = byDate.get(key)!;
		row.lunch += plan.lunch;
		row.dinner += plan.dinner;
		row.members.push({
			memberId: plan.member.id,
			name: plan.member.user.name,
			lunch: plan.lunch,
			dinner: plan.dinner,
		});
	}

	return [...byDate.values()];
};

const withDeadlines = (
	cycle: { id: string; year: number; month: number; status: CycleStatus },
	days: TPlanDay[],
) => {
	const now = new Date();

	return {
		cycle: {
			id: cycle.id,
			year: cycle.year,
			month: cycle.month,
			status: cycle.status,
		},
		totalPlannedMeals: days.reduce(
			(sum, day) => sum + day.lunch + day.dinner,
			0,
		),
		days: days.map((day) => {
			const deadline = planDeadlineFor(new Date(`${day.date}T00:00:00.000Z`));

			return {
				...day,
				deadline: formatDeadline(deadline),
				isLocked: now >= deadline,
			};
		}),
	};
};

const getCycleCalendar = async (
	cycleId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const cycle = await loadCycle(cycleId);

	await checkMessAccess(cycle.messId, user);

	if (query.date) {
		return withDeadlines(
			cycle,
			await buildPlanDays(cycleId, toDateOnly(new Date(query.date))),
		);
	}

	const days = await cached(
		cacheKeys.mealPlanCalendar(cycleId),
		CALENDAR_CACHE_SECONDS,
		() => buildPlanDays(cycleId),
	);

	return withDeadlines(cycle, days);
};

const applyPlanToRegister = async (
	payload: IApplyPlanPayload,
	user: RequestUser,
) => {
	const cycle = await loadCycle(payload.cycleId);

	await checkMessAccess(cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Fill The Register",
		);
	}

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Reopen It To Change Meals.",
		);
	}

	const date = toDateOnly(payload.date);

	const plans = await prisma.mealPlan.findMany({
		where: { cycleId: payload.cycleId, date },
		select: { memberId: true, lunch: true, dinner: true },
	});

	if (plans.length === 0) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Nobody Declared Meals For This Date",
		);
	}

	const existing = await prisma.mealEntry.findMany({
		where: { cycleId: payload.cycleId, date, isDeleted: false },
		select: { memberId: true },
	});

	const alreadyRecorded = new Set(existing.map((row) => row.memberId));

	const toCreate = plans.filter((plan) => !alreadyRecorded.has(plan.memberId));

	if (toCreate.length === 0) {
		return {
			date: date.toISOString().slice(0, 10),
			created: 0,
			skipped: plans.length,
			message: "Every Declared Member Already Has An Entry For This Date",
		};
	}

	await prisma.$transaction(async (tx) => {
		for (const plan of toCreate) {
			await tx.mealEntry.upsert({
				where: { memberId_date: { memberId: plan.memberId, date } },
				create: {
					cycleId: payload.cycleId,
					memberId: plan.memberId,
					date,
					lunch: plan.lunch,
					dinner: plan.dinner,
				},

				update: {
					lunch: plan.lunch,
					dinner: plan.dinner,
					isDeleted: false,
					deletedAt: null,
				},
			});
		}
	});

	return {
		date: date.toISOString().slice(0, 10),
		created: toCreate.length,
		skipped: plans.length - toCreate.length,
		message: "Declared Meals Copied Into The Register",
	};
};

export const MealPlanServices = {
	setMealPlan,
	getMyCalendar,
	getCycleCalendar,
	applyPlanToRegister,
};
