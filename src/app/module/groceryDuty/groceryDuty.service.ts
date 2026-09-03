import httpStatus from "http-status";
import { CycleStatus, Role } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { cached, cacheKeys, invalidateCache } from "../../utils/cache";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IAssignDutyPayload,
	IUpdateDutyPayload,
} from "./groceryDuty.interface";

const dutySelect = {
	id: true,
	startDate: true,
	endDate: true,
	note: true,
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

// The whole mess reads this calendar to see whose turn it is, while the manager
// books a handful of times a month - so it is dropped on every write and the TTL
// is only the backstop for a delete that never landed.
const CALENDAR_CACHE_SECONDS = 300;

/**
 * Only the manager assigns who shops. They live in the mess like everyone
 * else and can put themselves on the rota, but deciding the rota is
 * management, not membership - the same split as recording meals or expenses.
 */
const loadCycleForManager = async (cycleId: string, user: RequestUser) => {
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
			"Only The Mess Manager Can Assign Grocery Duty",
		);
	}

	return cycle;
};

const assertWithinCycle = (
	cycle: { year: number; month: number },
	startDate: Date,
	endDate: Date,
) => {
	const monthStart = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
	const monthEnd = new Date(Date.UTC(cycle.year, cycle.month, 0));

	if (startDate < monthStart || endDate > monthEnd) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Duty Dates Must Fall Inside ${cycle.month}/${cycle.year}`,
		);
	}
};

/**
 * Two members cannot both be "on duty" for the same day - it would leave
 * whoever reads the rota unable to tell who is actually shopping. Assigning
 * one range at a time and checking it against every other range already on
 * the cycle is what keeps that true, rather than trusting the caller not to
 * overlap.
 */
const assertNoOverlap = async (
	cycleId: string,
	startDate: Date,
	endDate: Date,
	excludeDutyId?: string,
) => {
	const overlapping = await prisma.groceryDuty.findFirst({
		where: {
			cycleId,
			id: excludeDutyId ? { not: excludeDutyId } : undefined,
			startDate: { lte: endDate },
			endDate: { gte: startDate },
		},
		select: {
			startDate: true,
			endDate: true,
			member: { select: { user: { select: { name: true } } } },
		},
	});

	if (overlapping) {
		const from = overlapping.startDate.toISOString().slice(0, 10);
		const to = overlapping.endDate.toISOString().slice(0, 10);
		throw new AppError(
			httpStatus.CONFLICT,
			`This Overlaps ${overlapping.member.user.name}'s Duty (${from} to ${to})`,
		);
	}
};

/**
 * The booking itself: one member, one date range, any length the manager
 * chooses - four days for one person, six for the next, exactly like picking
 * check-in and check-out dates. The calendar view is just this data read back
 * day by day; there is no separate "generate the month" step, because the
 * manager builds the month by making one booking at a time, the way they
 * would fill in a paper calendar.
 */
const assignDuty = async (payload: IAssignDutyPayload, user: RequestUser) => {
	const cycle = await loadCycleForManager(payload.cycleId, user);

	const member = await prisma.messMember.findFirst({
		where: { id: payload.memberId, messId: cycle.messId, isDeleted: false },
		select: { id: true },
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"This Member Does Not Belong To This Mess",
		);
	}

	const startDate = toDateOnly(payload.startDate);
	const endDate = toDateOnly(payload.endDate);

	assertWithinCycle(cycle, startDate, endDate);
	await assertNoOverlap(cycle.id, startDate, endDate);

	const duty = await prisma.groceryDuty.create({
		data: {
			cycleId: cycle.id,
			memberId: payload.memberId,
			startDate,
			endDate,
			note: payload.note ?? null,
		},
		select: dutySelect,
	});

	await invalidateCache(cacheKeys.groceryDutyCalendar(cycle.id));

	return duty;
};

const getCycleDuties = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	// Readable by the whole mess - the rota is exactly the kind of thing that
	// hangs on the wall, so everyone knows whose turn it is.
	await checkMessAccess(cycle.messId, user);

	return prisma.groceryDuty.findMany({
		where: { cycleId },
		orderBy: { startDate: "asc" },
		select: dutySelect,
	});
};

/**
 * The rota expanded to one row per calendar day, for a day-by-day view rather
 * than the raw list of ranges getCycleDuties returns. Readable by the whole
 * mess for the same reason the ranges are: whoever is up next needs to see it.
 */
const getCycleCalendar = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	// Cached below the access check on purpose: who may read this is decided per
	// caller on every request, and only the calendar body is shared between them.
	return cached(
		cacheKeys.groceryDutyCalendar(cycleId),
		CALENDAR_CACHE_SECONDS,
		async () => {
			const duties = await prisma.groceryDuty.findMany({
				where: { cycleId },
				orderBy: { startDate: "asc" },
				select: dutySelect,
			});

			const totalDays = new Date(
				Date.UTC(cycle.year, cycle.month, 0),
			).getUTCDate();

			const days = Array.from({ length: totalDays }, (_, index) => {
				const date = new Date(Date.UTC(cycle.year, cycle.month - 1, index + 1));

				const duty = duties.find(
					(d) => date >= d.startDate && date <= d.endDate,
				);

				return {
					date: date.toISOString().slice(0, 10),
					memberId: duty?.member.id ?? null,
					memberName: duty?.member.user.name ?? null,
				};
			});

			return {
				cycle: {
					id: cycle.id,
					year: cycle.year,
					month: cycle.month,
					status: cycle.status,
				},
				days,
			};
		},
	);
};

/**
 * How many days of duty the caller has this cycle, and which stretches they
 * came from - the answer to "this month, how many days did I do?" without
 * making them count ranges by hand.
 */
const getMyDutyDays = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	const membership = await checkMessAccess(cycle.messId, user);

	// A manager has a membership too (they live in the mess like everyone
	// else), so this only rejects an admin, who has no personal rota to ask
	// about.
	if (!membership) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Only A Mess Member Has A Personal Duty Record",
		);
	}

	const duties = await prisma.groceryDuty.findMany({
		where: { cycleId, memberId: membership.id },
		orderBy: { startDate: "asc" },
		select: { id: true, startDate: true, endDate: true, note: true },
	});

	const msPerDay = 1000 * 60 * 60 * 24;

	const turns = duties.map((duty) => ({
		startDate: duty.startDate.toISOString().slice(0, 10),
		endDate: duty.endDate.toISOString().slice(0, 10),
		days:
			Math.round(
				(duty.endDate.getTime() - duty.startDate.getTime()) / msPerDay,
			) + 1,
		note: duty.note,
	}));

	return {
		cycle: {
			id: cycle.id,
			year: cycle.year,
			month: cycle.month,
			status: cycle.status,
		},
		memberId: membership.id,
		totalDays: turns.reduce((sum, turn) => sum + turn.days, 0),
		turns,
	};
};

const updateDuty = async (
	dutyId: string,
	payload: IUpdateDutyPayload,
	user: RequestUser,
) => {
	const duty = await prisma.groceryDuty.findUnique({
		where: { id: dutyId },
		select: {
			id: true,
			cycleId: true,
			startDate: true,
			endDate: true,
			cycle: { select: { year: true, month: true, messId: true } },
		},
	});

	if (!duty) {
		throw new AppError(httpStatus.NOT_FOUND, "Grocery Duty Not Found");
	}

	await checkMessAccess(duty.cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Change Grocery Duty",
		);
	}

	if (payload.memberId) {
		const member = await prisma.messMember.findFirst({
			where: {
				id: payload.memberId,
				messId: duty.cycle.messId,
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
	}

	const startDate = payload.startDate
		? toDateOnly(payload.startDate)
		: duty.startDate;
	const endDate = payload.endDate ? toDateOnly(payload.endDate) : duty.endDate;

	if (payload.startDate || payload.endDate) {
		assertWithinCycle(duty.cycle, startDate, endDate);
		await assertNoOverlap(duty.cycleId, startDate, endDate, duty.id);
	}

	const updated = await prisma.groceryDuty.update({
		where: { id: dutyId },
		data: {
			memberId: payload.memberId,
			startDate,
			endDate,
			note: payload.note,
		},
		select: dutySelect,
	});

	await invalidateCache(cacheKeys.groceryDutyCalendar(duty.cycleId));

	return updated;
};

const removeDuty = async (dutyId: string, user: RequestUser) => {
	const duty = await prisma.groceryDuty.findUnique({
		where: { id: dutyId },
		select: { id: true, cycleId: true, cycle: { select: { messId: true } } },
	});

	if (!duty) {
		throw new AppError(httpStatus.NOT_FOUND, "Grocery Duty Not Found");
	}

	await checkMessAccess(duty.cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Remove Grocery Duty",
		);
	}

	// Hard delete: a rota entry carries no financial history the way a meal or
	// an expense does, so there is nothing here that soft delete needs to keep.
	await prisma.groceryDuty.delete({ where: { id: dutyId } });

	await invalidateCache(cacheKeys.groceryDutyCalendar(duty.cycleId));

	return { id: dutyId };
};

export const GroceryDutyServices = {
	assignDuty,
	getCycleDuties,
	getCycleCalendar,
	getMyDutyDays,
	updateDuty,
	removeDuty,
};
