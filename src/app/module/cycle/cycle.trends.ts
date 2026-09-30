import type { ExpenseType } from "../../../generated/prisma/enums";
import { dueAt, type TTrendBill } from "../admin/admin.trends";

const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Split equally on every bill — what the overview calls "shared bills". */
const SHARED_TYPES: ExpenseType[] = [
	"MAID",
	"GAS",
	"ELECTRICITY",
	"WATER",
	"INTERNET",
	"OTHER",
];

export type TCycleTrendInput = {
	/** First and last day to report, as UTC midnights of Dhaka dates. */
	from: Date;
	to: Date;
	meals: { date: Date; lunch: number; dinner: number; memberId: string }[];
	expenses: { spentAt: Date; type: ExpenseType; amount: number }[];
	/** The caller's own membership; null for an admin or a non-eating manager. */
	memberId: string | null;
	/** Bills of the month before, to follow what is still owed on it. */
	previousBills: TTrendBill[] | null;
};

export type TCycleTrends = {
	days: string[];
	meals: number[];
	grocery: number[];
	shared: number[];
	myMeals: number[] | null;
	previousDue: number[] | null;
};

/** The Dhaka calendar day a moment falls on, as a UTC midnight. */
const dhakaDay = (moment: Date) => {
	const shifted = new Date(moment.getTime() + DHAKA_OFFSET_MS);
	return Date.UTC(
		shifted.getUTCFullYear(),
		shifted.getUTCMonth(),
		shifted.getUTCDate(),
	);
};

const toPaisa = (taka: number) => Math.round(taka * 100);

/**
 * One value per day of the month so far — not running totals; the client
 * accumulates what it needs (a running meal rate is running grocery over
 * running meals).
 */
export const buildCycleTrends = (input: TCycleTrendInput): TCycleTrends => {
	const days: number[] = [];
	for (
		let day = input.from.getTime();
		day <= input.to.getTime();
		day += DAY_MS
	) {
		days.push(day);
	}

	const perDay = <T>(
		rows: T[],
		dayOf: (row: T) => number,
		value: (row: T) => number,
	) => {
		const totals = new Map<number, number>();
		for (const row of rows) {
			const day = dayOf(row);
			totals.set(day, (totals.get(day) ?? 0) + value(row));
		}
		return days.map((day) => totals.get(day) ?? 0);
	};

	const mealDay = (meal: { date: Date }) => meal.date.getTime();
	const mealCount = (meal: { lunch: number; dinner: number }) =>
		meal.lunch + meal.dinner;
	const spentDay = (expense: { spentAt: Date }) => dhakaDay(expense.spentAt);
	const paisa = (expense: { amount: number }) => toPaisa(expense.amount);

	const grocery = perDay(
		input.expenses.filter((expense) => expense.type === "GROCERY"),
		spentDay,
		paisa,
	);
	const shared = perDay(
		input.expenses.filter((expense) => SHARED_TYPES.includes(expense.type)),
		spentDay,
		paisa,
	);

	return {
		days: days.map((day) => new Date(day).toISOString().slice(0, 10)),
		meals: perDay(input.meals, mealDay, mealCount),
		grocery: grocery.map((value) => value / 100),
		shared: shared.map((value) => value / 100),
		myMeals: input.memberId
			? perDay(
					input.meals.filter((meal) => meal.memberId === input.memberId),
					mealDay,
					mealCount,
				)
			: null,
		// Owed at the close of each Dhaka day.
		previousDue: input.previousBills
			? days.map((day) => {
					const endOfDay = new Date(day + DAY_MS - DHAKA_OFFSET_MS);
					const bills = input.previousBills ?? [];
					return (
						bills.reduce((sum, bill) => sum + dueAt(bill, endOfDay), 0) / 100
					);
				})
			: null,
	};
};
