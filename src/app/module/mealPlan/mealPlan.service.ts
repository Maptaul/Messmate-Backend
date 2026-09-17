import httpStatus from "http-status";
import {
	CycleStatus,
	MemberStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { cached, cacheKeys, invalidateCache } from "../../utils/cache";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IApplyPlanPayload,
	ISetDefaultMealsPayload,
	ISetMealPlanPayload,
} from "./mealPlan.interface";

const DHAKA_UTC_OFFSET_HOURS = 6;

const CUTOFF_HOUR_LOCAL = 23;

const DAY_MS = 24 * 60 * 60 * 1000;

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

type TPlanCycle = { id: string; messId: string; year: number; month: number };

type TDefaultMember = {
	id: string;
	name: string;
	joinedAt: Date;
	leftAt: Date | null;
	defaultLunch: number;
	defaultDinner: number;
};

type TMealRow = {
	memberId: string;
	name: string;
	lunch: number;
	dinner: number;
	isDefault: boolean;
};

const isInCycle = (cycle: TPlanCycle, date: Date) =>
	date.getUTCFullYear() === cycle.year &&
	date.getUTCMonth() + 1 === cycle.month;

// A declared plan always wins, even 0/0: that is how a member switches a day
// off. Only a member with no plan at all for the day falls back to a default.
export const defaultMealsFor = (
	date: Date,
	plannedMemberIds: Set<string>,
	members: TDefaultMember[],
): TMealRow[] =>
	members
		.filter(
			(member) =>
				!plannedMemberIds.has(member.id) &&
				(member.defaultLunch > 0 || member.defaultDinner > 0) &&
				toDateOnly(member.joinedAt) <= date &&
				(!member.leftAt || toDateOnly(member.leftAt) >= date),
		)
		.map((member) => ({
			memberId: member.id,
			name: member.name,
			lunch: member.defaultLunch,
			dinner: member.defaultDinner,
			isDefault: true,
		}));

const loadDefaultMembers = async (
	messId: string,
	memberIds?: string[],
): Promise<TDefaultMember[]> => {
	const members = await prisma.messMember.findMany({
		where: {
			messId,
			status: MemberStatus.ACTIVE,
			isDeleted: false,
			...(memberIds ? { id: { in: memberIds } } : {}),
			OR: [{ defaultLunch: { gt: 0 } }, { defaultDinner: { gt: 0 } }],
		},
		select: {
			id: true,
			joinedAt: true,
			leftAt: true,
			defaultLunch: true,
			defaultDinner: true,
			user: { select: { name: true } },
		},
	});

	return members.map(({ user, ...member }) => ({ ...member, name: user.name }));
};

// Freezes a locked day: a member who never declared it gets their default
// written as a real plan, so changing the default afterwards cannot rewrite a
// day the manager has already shopped for.
export const lockInDefaultMeals = async (
	cycle: TPlanCycle,
	date: Date,
	memberIds?: string[],
) => {
	if (!isInCycle(cycle, date)) {
		return 0;
	}

	const [plans, members] = await Promise.all([
		prisma.mealPlan.findMany({
			where: { cycleId: cycle.id, date },
			select: { memberId: true },
		}),
		loadDefaultMembers(cycle.messId, memberIds),
	]);

	const rows = defaultMealsFor(
		date,
		new Set(plans.map((plan) => plan.memberId)),
		members,
	);

	if (rows.length === 0) {
		return 0;
	}

	const { count } = await prisma.mealPlan.createMany({
		data: rows.map((row) => ({
			cycleId: cycle.id,
			memberId: row.memberId,
			date,
			lunch: row.lunch,
			dinner: row.dinner,
		})),
		skipDuplicates: true,
	});

	await invalidateCache(cacheKeys.mealPlanCalendar(cycle.id));

	return count;
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

const pickMemberId = (
	user: RequestUser,
	membership: { id: string } | null,
	requestedId?: string,
) => {
	if (user.role === Role.MEMBER) {
		if (!membership) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not A Member Of This Mess",
			);
		}

		if (requestedId && requestedId !== membership.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Can Only Plan Your Own Meals",
			);
		}

		return membership.id;
	}

	if (requestedId) {
		return requestedId;
	}

	if (membership) {
		return membership.id;
	}

	throw new AppError(
		httpStatus.BAD_REQUEST,
		"Member Id Is Required When You Are Not A Member Of This Mess",
	);
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

	const memberId = pickMemberId(user, membership, payload.memberId);

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

const setDefaultMeals = async (
	payload: ISetDefaultMealsPayload,
	user: RequestUser,
) => {
	const membership = await checkMessAccess(payload.messId, user);

	const memberId = pickMemberId(user, membership, payload.memberId);

	const member = await prisma.messMember.findFirst({
		where: {
			id: memberId,
			messId: payload.messId,
			status: MemberStatus.ACTIVE,
			isDeleted: false,
		},
		select: { id: true },
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"This Member Does Not Belong To This Mess",
		);
	}

	const openCycle = await prisma.billingCycle.findFirst({
		where: { messId: payload.messId, status: CycleStatus.OPEN },
		select: { id: true, messId: true, year: true, month: true },
	});

	if (openCycle) {
		const now = new Date();
		const dhakaToday = toDateOnly(
			new Date(now.getTime() + DHAKA_UTC_OFFSET_HOURS * 60 * 60 * 1000),
		);

		for (const day of [dhakaToday, new Date(dhakaToday.getTime() + DAY_MS)]) {
			if (now >= planDeadlineFor(day)) {
				await lockInDefaultMeals(openCycle, day, [member.id]);
			}
		}
	}

	const updated = await prisma.messMember.update({
		where: { id: member.id },
		data: { defaultLunch: payload.lunch, defaultDinner: payload.dinner },
		select: {
			id: true,
			defaultLunch: true,
			defaultDinner: true,
			user: { select: { id: true, name: true } },
		},
	});

	if (openCycle) {
		await invalidateCache(cacheKeys.mealPlanCalendar(openCycle.id));
	}

	return updated;
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

	const [plans, defaults] = await Promise.all([
		prisma.mealPlan.findMany({
			where: { cycleId, memberId: membership.id },
			orderBy: { date: "asc" },
			select: {
				id: true,
				date: true,
				lunch: true,
				dinner: true,
				updatedAt: true,
			},
		}),
		prisma.messMember.findUnique({
			where: { id: membership.id },
			select: { defaultLunch: true, defaultDinner: true },
		}),
	]);

	const self: TDefaultMember = {
		id: membership.id,
		name: "",
		joinedAt: membership.joinedAt,
		leftAt: membership.leftAt,
		defaultLunch: defaults?.defaultLunch ?? 0,
		defaultDinner: defaults?.defaultDinner ?? 0,
	};

	const planByDate = new Map(
		plans.map((plan) => [plan.date.toISOString().slice(0, 10), plan]),
	);

	const now = new Date();
	const totalDays = new Date(Date.UTC(cycle.year, cycle.month, 0)).getUTCDate();

	const days = Array.from({ length: totalDays }, (_, index) => {
		const date = new Date(Date.UTC(cycle.year, cycle.month - 1, index + 1));
		const key = date.toISOString().slice(0, 10);
		const plan = planByDate.get(key);
		const fallback = plan
			? undefined
			: defaultMealsFor(date, new Set(), [self])[0];
		const deadline = planDeadlineFor(date);

		return {
			date: key,
			lunch: plan?.lunch ?? fallback?.lunch ?? 0,
			dinner: plan?.dinner ?? fallback?.dinner ?? 0,
			isPlanned: Boolean(plan),
			isDefault: Boolean(fallback),
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
		defaultMeals: { lunch: self.defaultLunch, dinner: self.defaultDinner },
		plannedMeals: days.reduce((sum, day) => sum + day.lunch + day.dinner, 0),
		days,
	};
};

const CALENDAR_CACHE_SECONDS = 300;

type TPlanDay = {
	date: string;
	lunch: number;
	dinner: number;
	members: TMealRow[];
};

export const buildPlanDays = async (
	cycle: TPlanCycle,
	date?: Date,
): Promise<TPlanDay[]> => {
	if (date && !isInCycle(cycle, date)) {
		return [];
	}

	const [plans, defaultMembers] = await Promise.all([
		prisma.mealPlan.findMany({
			where: date ? { cycleId: cycle.id, date } : { cycleId: cycle.id },
			orderBy: [{ date: "asc" }],
			select: planSelect,
		}),
		loadDefaultMembers(cycle.messId),
	]);

	const plansByDate = new Map<string, TMealRow[]>();

	for (const plan of plans) {
		const key = plan.date.toISOString().slice(0, 10);

		plansByDate.set(key, [
			...(plansByDate.get(key) ?? []),
			{
				memberId: plan.member.id,
				name: plan.member.user.name,
				lunch: plan.lunch,
				dinner: plan.dinner,
				isDefault: false,
			},
		]);
	}

	const totalDays = new Date(Date.UTC(cycle.year, cycle.month, 0)).getUTCDate();

	const dates = date
		? [date]
		: Array.from(
				{ length: totalDays },
				(_, index) =>
					new Date(Date.UTC(cycle.year, cycle.month - 1, index + 1)),
			);

	return dates.flatMap((day) => {
		const key = day.toISOString().slice(0, 10);
		const planned = plansByDate.get(key) ?? [];

		const members = [
			...planned,
			...defaultMealsFor(
				day,
				new Set(planned.map((row) => row.memberId)),
				defaultMembers,
			),
		];

		if (members.length === 0) {
			return [];
		}

		return [
			{
				date: key,
				lunch: members.reduce((sum, row) => sum + row.lunch, 0),
				dinner: members.reduce((sum, row) => sum + row.dinner, 0),
				members,
			},
		];
	});
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
			await buildPlanDays(cycle, toDateOnly(new Date(query.date))),
		);
	}

	const days = await cached(
		cacheKeys.mealPlanCalendar(cycleId),
		CALENDAR_CACHE_SECONDS,
		() => buildPlanDays(cycle),
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

	if (!isInCycle(cycle, date)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This Date Is Outside The Cycle For ${cycle.month}/${cycle.year}`,
		);
	}

	const [plans, defaultMembers] = await Promise.all([
		prisma.mealPlan.findMany({
			where: { cycleId: payload.cycleId, date },
			select: { memberId: true, lunch: true, dinner: true },
		}),
		loadDefaultMembers(cycle.messId),
	]);

	const meals = [
		...plans.map((plan) => ({ ...plan, isDefault: false })),
		...defaultMealsFor(
			date,
			new Set(plans.map((plan) => plan.memberId)),
			defaultMembers,
		),
	];

	if (meals.length === 0) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Nobody Declared Meals For This Date",
		);
	}

	const existing = await prisma.mealEntry.findMany({
		where: { cycleId: payload.cycleId, date },
		select: { memberId: true },
	});

	const alreadyRecorded = new Set(existing.map((row) => row.memberId));

	const toCreate = meals.filter((meal) => !alreadyRecorded.has(meal.memberId));

	if (toCreate.length === 0) {
		return {
			date: date.toISOString().slice(0, 10),
			created: 0,
			fromDefaults: 0,
			skipped: meals.length,
			message: "Every Declared Member Already Has An Entry For This Date",
		};
	}

	await prisma.$transaction(async (tx) => {
		for (const meal of toCreate) {
			await tx.mealEntry.upsert({
				where: { memberId_date: { memberId: meal.memberId, date } },
				create: {
					cycleId: payload.cycleId,
					memberId: meal.memberId,
					date,
					lunch: meal.lunch,
					dinner: meal.dinner,
				},

				update: {
					lunch: meal.lunch,
					dinner: meal.dinner,
					isDeleted: false,
					deletedAt: null,
				},
			});
		}
	});

	return {
		date: date.toISOString().slice(0, 10),
		created: toCreate.length,
		fromDefaults: toCreate.filter((meal) => meal.isDefault).length,
		skipped: meals.length - toCreate.length,
		message: "Declared Meals Copied Into The Register",
	};
};

export const MealPlanServices = {
	setMealPlan,
	setDefaultMeals,
	getMyCalendar,
	getCycleCalendar,
	applyPlanToRegister,
};
