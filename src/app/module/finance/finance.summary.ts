import type {
	FinanceCategory,
	FinanceEntryType,
} from "../../../generated/prisma/enums";
import type { TFinancePeriod } from "./finance.constant";

const DAY_MS = 24 * 60 * 60 * 1000;

const toPaisa = (taka: number) => Math.round(taka * 100);
const toTaka = (paisa: number) => paisa / 100;

const utcDay = (year: number, monthIndex: number, day: number) =>
	new Date(Date.UTC(year, monthIndex, day));

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export type TPeriodRange = { from: Date; to: Date };

// A week runs Saturday to Friday, the way it does in Bangladesh.
export const periodRange = (
	period: TFinancePeriod,
	anchor: Date,
): TPeriodRange => {
	const year = anchor.getUTCFullYear();
	const month = anchor.getUTCMonth();
	const day = anchor.getUTCDate();

	switch (period) {
		case "daily":
			return { from: utcDay(year, month, day), to: utcDay(year, month, day) };
		case "weekly": {
			const sinceSaturday = (anchor.getUTCDay() + 1) % 7;

			return {
				from: utcDay(year, month, day - sinceSaturday),
				to: utcDay(year, month, day - sinceSaturday + 6),
			};
		}
		case "monthly":
			return { from: utcDay(year, month, 1), to: utcDay(year, month + 1, 0) };
		case "yearly":
			return { from: utcDay(year, 0, 1), to: utcDay(year, 11, 31) };
	}
};

type TBucket = { label: string; from: Date; to: Date };

const bucketsFor = (period: TFinancePeriod, range: TPeriodRange): TBucket[] => {
	if (period === "daily") {
		return [];
	}

	if (period === "yearly") {
		const year = range.from.getUTCFullYear();

		return Array.from({ length: 12 }, (_, index) => ({
			label: `${year}-${String(index + 1).padStart(2, "0")}`,
			from: utcDay(year, index, 1),
			to: utcDay(year, index + 1, 0),
		}));
	}

	const days =
		Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS) + 1;

	return Array.from({ length: days }, (_, index) => {
		const date = new Date(range.from.getTime() + index * DAY_MS);

		return { label: isoDay(date), from: date, to: date };
	});
};

export type TSummaryRow = {
	date: Date;
	type: FinanceEntryType;
	category: FinanceCategory;
	amount: number;
};

// Everything is added up in paisa, so a hundred small entries cannot drift.
export const buildSummary = (
	period: TFinancePeriod,
	range: TPeriodRange,
	rows: TSummaryRow[],
) => {
	const totals = { INCOME: 0, EXPENSE: 0 };

	const byCategory = {
		INCOME: new Map<FinanceCategory, number>(),
		EXPENSE: new Map<FinanceCategory, number>(),
	};

	const buckets = bucketsFor(period, range).map((bucket) => ({
		...bucket,
		INCOME: 0,
		EXPENSE: 0,
	}));

	for (const row of rows) {
		const paisa = toPaisa(row.amount);

		totals[row.type] += paisa;

		const categories = byCategory[row.type];
		categories.set(row.category, (categories.get(row.category) ?? 0) + paisa);

		const bucket = buckets.find(
			(candidate) => row.date >= candidate.from && row.date <= candidate.to,
		);

		if (bucket) {
			bucket[row.type] += paisa;
		}
	}

	const categoryTotals = (type: FinanceEntryType) =>
		[...byCategory[type].entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.map(([category, paisa]) => ({ category, total: toTaka(paisa) }));

	return {
		period,
		from: isoDay(range.from),
		to: isoDay(range.to),
		income: toTaka(totals.INCOME),
		expense: toTaka(totals.EXPENSE),
		balance: toTaka(totals.INCOME - totals.EXPENSE),
		byCategory: {
			income: categoryTotals("INCOME"),
			expense: categoryTotals("EXPENSE"),
		},
		breakdown: buckets.map((bucket) => ({
			label: bucket.label,
			from: isoDay(bucket.from),
			to: isoDay(bucket.to),
			income: toTaka(bucket.INCOME),
			expense: toTaka(bucket.EXPENSE),
			balance: toTaka(bucket.INCOME - bucket.EXPENSE),
		})),
	};
};
