import httpStatus from "http-status";
import { CycleStatus, Role } from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IApplyPlanPayload,
	ISetMealPlanPayload,
} from "./mealPlan.interface";

/**
 * The mess is in Bangladesh, and the deployed server runs in UTC. Doing this
 * arithmetic in server-local time would move every deadline by six hours, so
 * the offset is explicit rather than inherited from the host.
 */
const DHAKA_UTC_OFFSET_HOURS = 6;

/** Declarations for a day close at 11 PM the night before. */
const CUTOFF_HOUR_LOCAL = 23;

const toDateOnly = (date: Date) =>
	new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);

/**
 * The moment a day stops accepting declarations.
 *
 * For the 4th, that is 11 PM on the 3rd in Dhaka, which is 17:00 UTC on the 3rd.
 * Declaring for the 4th on the 4th is therefore always too late - which is the
 * whole point, since the manager shops and cooks that morning.
 */
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

/**
 * Declares which meals a member will take, for one or more days of the month.
 *
 * Every day is checked against its own deadline before anything is written, and
 * the whole set goes in one transaction. Saving the days that were still open
 * and rejecting the rest would leave the member unsure what they actually
 * declared.
 */
const setMealPlan = async (
	payload: ISetMealPlanPayload,
	user: RequestUser,
) => {
	const cycle = await loadCycle(payload.cycleId);

	const membership = await checkMessAccess(cycle.messId, user);

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Meals Can No Longer Be Planned For It.",
		);
	}

	// A member plans only for themselves. A manager may name someone else - for
	// the person who told them in the corridor rather than in the app - but when
	// they leave memberId out they are planning their own meals, because the
	// manager lives in the mess and eats there like everyone else.
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
		// An admin, or a manager who does not live in the mess, has nobody to
		// plan for unless they say who.
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

	return prisma.$transaction(async (tx) => {
		const saved = [];

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
				// Changing your mind before the cutoff updates the declaration
				// rather than stacking a second one on top of it.
				update: { lunch: day.lunch, dinner: day.dinner },
				select: planSelect,
			});

			saved.push(row);
		}

		return saved;
	});
};

/**
 * A member own month, day by day, with the deadline for each.
 *
 * `isLocked` is what a calendar UI needs: it says which days can still be
 * changed without the client having to know the cutoff rule.
 */
const getMyCalendar = async (cycleId: string, user: RequestUser) => {
	const cycle = await loadCycle(cycleId);

	const membership = await checkMessAccess(cycle.messId, user);

	// A manager has a membership too, so this only rejects an admin, who lives
	// in no mess and therefore has no personal calendar.
	if (!membership) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Only A Mess Member Has A Personal Meal Calendar",
		);
	}

	const plans = await prisma.mealPlan.findMany({
		where: { cycleId, memberId: membership.id },
		orderBy: { date: "asc" },
		select: { id: true, date: true, lunch: true, dinner: true, updatedAt: true },
	});

	const planByDate = new Map(
		plans.map((plan) => [plan.date.toISOString().slice(0, 10), plan]),
	);

	const now = new Date();
	const totalDays = new Date(
		Date.UTC(cycle.year, cycle.month, 0),
	).getUTCDate();

	// Every day of the month is returned, planned or not, so the client renders
	// a full calendar instead of a sparse list with holes in it.
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

/**
 * What the manager needs before shopping: how many lunches and dinners each day
 * of the month is expected to need, and who is behind those numbers.
 */
const getCycleCalendar = async (
	cycleId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const cycle = await loadCycle(cycleId);

	// Everyone in the mess can read this. Grocery duty rotates, so the person
	// shopping on the 10th is usually a member rather than the manager, and the
	// whole point of declaring in advance is that whoever shops knows the count.
	// Nothing here is private either - a mess meal chart hangs on the wall, and
	// being able to check it is how members verify the register.
	await checkMessAccess(cycle.messId, user);

	const where = query.date
		? { cycleId, date: toDateOnly(new Date(query.date)) }
		: { cycleId };

	const plans = await prisma.mealPlan.findMany({
		where,
		orderBy: [{ date: "asc" }],
		select: planSelect,
	});

	const byDate = new Map<
		string,
		{
			date: string;
			lunch: number;
			dinner: number;
			deadline: string;
			isLocked: boolean;
			members: { memberId: string; name: string; lunch: number; dinner: number }[];
		}
	>();

	const now = new Date();

	for (const plan of plans) {
		const key = plan.date.toISOString().slice(0, 10);

		if (!byDate.has(key)) {
			const deadline = planDeadlineFor(plan.date);
			byDate.set(key, {
				date: key,
				lunch: 0,
				dinner: 0,
				deadline: formatDeadline(deadline),
				isLocked: now >= deadline,
				members: [],
			});
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

	const days = [...byDate.values()];

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
		days,
	};
};

/**
 * Copies one day of declarations into the actual register.
 *
 * The plan is what people said they would eat; MealEntry is what they are
 * charged for. This is the bridge, so the manager starts the day from what was
 * declared instead of retyping it, and then corrects whatever actually
 * happened. Existing entries are left alone - a correction already made must
 * not be undone by re-applying the plan.
 */
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
				// Only reached for a soft-deleted row, which the query above cannot
				// see. Restoring it beats failing on the unique key.
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
