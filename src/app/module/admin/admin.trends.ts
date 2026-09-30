const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const TREND_POINTS = 7;

export type TTrendBill = {
	createdAt: Date;
	totalPayable: number;
	creditAmount: number;
	payments: { amount: number; paidAt: Date | null }[];
};

export type TPlatformTrendInput = {
	users: Date[];
	messes: Date[];
	cycles: { createdAt: Date; closedAt: Date | null }[];
	bills: TTrendBill[];
};

export type TPlatformTrends = {
	points: string[];
	users: number[];
	messes: number[];
	openCycles: number[];
	outstandingDue: number[];
};

/** The last `count` week ends, oldest first, the newest being `now`. */
export const weekEnds = (now: Date, count = TREND_POINTS) =>
	Array.from(
		{ length: count },
		(_, index) => new Date(now.getTime() - (count - 1 - index) * WEEK_MS),
	);

const toPaisa = (taka: number) => Math.round(taka * 100);

/**
 * What a bill still owed at `at`: its payable after credits, less every
 * payment made by then — never below zero, a credit owes nothing.
 */
export const dueAt = (bill: TTrendBill, at: Date) => {
	if (bill.createdAt > at) {
		return 0;
	}

	const paid = bill.payments
		.filter((payment) => payment.paidAt && payment.paidAt <= at)
		.reduce((sum, payment) => sum + toPaisa(payment.amount), 0);

	const owed = toPaisa(bill.totalPayable) - toPaisa(bill.creditAmount) - paid;

	return Math.max(0, owed);
};

/**
 * The admin overview's sparklines: at each point, how many users and messes
 * existed, how many billing cycles were open, and what was still owed.
 */
export const buildPlatformTrends = (
	input: TPlatformTrendInput,
	points: Date[],
): TPlatformTrends => {
	const countUpTo = (dates: Date[], at: Date) =>
		dates.filter((date) => date <= at).length;

	return {
		points: points.map((point) => point.toISOString()),
		users: points.map((at) => countUpTo(input.users, at)),
		messes: points.map((at) => countUpTo(input.messes, at)),
		openCycles: points.map(
			(at) =>
				input.cycles.filter(
					(cycle) =>
						cycle.createdAt <= at && (!cycle.closedAt || cycle.closedAt > at),
				).length,
		),
		outstandingDue: points.map(
			(at) => input.bills.reduce((sum, bill) => sum + dueAt(bill, at), 0) / 100,
		),
	};
};
