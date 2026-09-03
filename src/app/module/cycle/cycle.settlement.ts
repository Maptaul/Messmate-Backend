import type { ExpenseType, SplitMethod } from "../../../generated/prisma/enums";

/**
 * The monthly settlement, as a pure function.
 *
 * No Prisma client, no request, no I/O - it takes plain numbers and returns
 * plain numbers. That is what lets scripts/check-settlement.ts prove the maths
 * without a database, and what makes it explainable on its own.
 *
 * Everything inside runs in integer paisa. Splitting money with floating point
 * leaves stray fractions that never add back up, and a ledger that does not sum
 * is a wrong ledger no matter how tidy each row looks.
 */

export type SettlementMember = {
	memberId: string;
	/** lunch + dinner across the whole cycle */
	mealCount: number;
	/** cash handed to the manager during the month */
	depositTotal: number;
	/** expenses this member paid for out of their own pocket */
	paidExpenseTotal: number;
	/** days between joining and leaving, inside this month */
	daysPresent: number;
};

export type SettlementExpense = {
	type: ExpenseType;
	amount: number;
	splitMethod: SplitMethod;
};

export type SettlementInput = {
	members: SettlementMember[];
	expenses: SettlementExpense[];
	monthlyRent: number;
	daysInMonth: number;
};

export type SettlementBill = {
	memberId: string;
	mealCount: number;
	mealCost: number;
	sharedCost: number;
	rentShare: number;
	totalPayable: number;
	creditAmount: number;
	dueAmount: number;
};

export type SettlementResult = {
	totalMeals: number;
	totalGrocery: number;
	mealRate: number;
	bills: SettlementBill[];
};

const toPaisa = (taka: number) => Math.round(taka * 100);
const toTaka = (paisa: number) => paisa / 100;

/**
 * Splits `totalPaisa` across `weights` so the parts add back to exactly the
 * total. Each share is rounded down first, then the leftover paisa go to the
 * largest fractional remainders - the standard largest-remainder method.
 *
 * Ties break towards the earlier index, which keeps the result deterministic:
 * the same input always produces the same bill.
 */
const allocate = (totalPaisa: number, weights: number[]): number[] => {
	const weightSum = weights.reduce((sum, w) => sum + w, 0);

	if (weightSum <= 0 || totalPaisa === 0) {
		return weights.map(() => 0);
	}

	const exact = weights.map((w) => (totalPaisa * w) / weightSum);
	const shares = exact.map((value) => Math.floor(value));

	let remainder = totalPaisa - shares.reduce((sum, s) => sum + s, 0);

	const order = exact
		.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
		.sort((a, b) => b.fraction - a.fraction || a.index - b.index);

	for (let i = 0; remainder > 0; i = (i + 1) % order.length) {
		shares[order[i]!.index]! += 1;
		remainder -= 1;
	}

	return shares;
};

export const computeSettlement = (input: SettlementInput): SettlementResult => {
	const { members, expenses, monthlyRent, daysInMonth } = input;

	const totalMeals = members.reduce((sum, m) => sum + m.mealCount, 0);

	const groceryPaisa = expenses
		.filter((e) => e.type === "GROCERY")
		.reduce((sum, e) => sum + toPaisa(e.amount), 0);

	// A rate, not a total, so it keeps four decimals. It is reported, never used
	// to derive a member share - those come from allocate() below, which is what
	// keeps the parts summing to the whole.
	const mealRate =
		totalMeals > 0 ? Number((toTaka(groceryPaisa) / totalMeals).toFixed(4)) : 0;

	// GROCERY is excluded here because it is already distributed through the
	// meal split; counting it again would charge everyone twice for the food.
	// RENT is excluded because it is prorated by tenure, not split flat.
	const sharedExpenses = expenses.filter(
		(e) => e.type !== "GROCERY" && e.type !== "RENT",
	);

	const mealShares = allocate(
		groceryPaisa,
		members.map((m) => m.mealCount),
	);

	const sharedShares = members.map(() => 0);

	for (const expense of sharedExpenses) {
		const weights =
			expense.splitMethod === "BY_MEAL"
				? members.map((m) => m.mealCount)
				: members.map(() => 1);

		// A BY_MEAL expense in a month where nobody ate has no meals to divide
		// by, so it falls back to an equal split rather than vanishing.
		const usable = weights.some((w) => w > 0) ? weights : members.map(() => 1);

		const parts = allocate(toPaisa(expense.amount), usable);
		parts.forEach((part, index) => {
			sharedShares[index]! += part;
		});
	}

	// Rent is weighted by days present rather than scaled by them. The mess owes
	// the landlord the full rent whatever the occupancy, so proration decides how
	// the burden is shared, not how much is collected. Weighting keeps the parts
	// adding up to the whole rent; scaling each share by daysPresent/daysInMonth
	// would quietly leave a shortfall nobody pays whenever someone leaves early.
	const dayWeights = members.map((m) => Math.min(m.daysPresent, daysInMonth));

	// If nobody registers a day present - a month opened for a period before
	// anyone joined, say - the rent would otherwise be allocated to no one and
	// quietly disappear. The mess still owes the landlord, so it falls back to an
	// equal split, the same way a BY_MEAL expense does when there are no meals.
	const usableDayWeights = dayWeights.some((d) => d > 0)
		? dayWeights
		: members.map(() => 1);

	const rentShares = allocate(toPaisa(monthlyRent), usableDayWeights);

	const bills: SettlementBill[] = members.map((member, index) => {
		const mealCost = mealShares[index]!;
		const sharedCost = sharedShares[index]!;
		const rentShare = rentShares[index]!;
		const totalPayable = mealCost + sharedCost + rentShare;
		const creditAmount =
			toPaisa(member.depositTotal) + toPaisa(member.paidExpenseTotal);

		return {
			memberId: member.memberId,
			mealCount: member.mealCount,
			mealCost: toTaka(mealCost),
			sharedCost: toTaka(sharedCost),
			rentShare: toTaka(rentShare),
			totalPayable: toTaka(totalPayable),
			creditAmount: toTaka(creditAmount),
			// Negative is correct and kept: the mess owes this member, because
			// they paid for more than they consumed.
			dueAmount: toTaka(totalPayable - creditAmount),
		};
	});

	return {
		totalMeals,
		totalGrocery: toTaka(groceryPaisa),
		mealRate,
		bills,
	};
};
