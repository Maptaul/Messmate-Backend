import type { ExpenseType, SplitMethod } from "../../../generated/prisma/enums";

export type SettlementMember = {
	memberId: string;

	mealCount: number;

	depositTotal: number;

	paidExpenseTotal: number;

	daysPresent: number;

	openingBalance: number;
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

	monthlyDeposit: number;
};

export type SettlementShare = {
	type: ExpenseType;
	amount: number;
};

export type SettlementBill = {
	memberId: string;
	openingBalance: number;
	mealCount: number;
	mealCost: number;
	sharedCost: number;
	sharedBreakdown: SettlementShare[];
	rentShare: number;
	advanceCharged: number;
	totalPayable: number;
	depositTotal: number;
	paidExpenseTotal: number;
	creditAmount: number;
	dueAmount: number;
};

const SHARED_TYPE_ORDER: ExpenseType[] = [
	"MAID",
	"GAS",
	"ELECTRICITY",
	"WATER",
	"INTERNET",
	"OTHER",
];

export type SettlementResult = {
	totalMeals: number;
	totalGrocery: number;
	mealRate: number;
	bills: SettlementBill[];
};

const toPaisa = (taka: number) => Math.round(taka * 100);
const toTaka = (paisa: number) => paisa / 100;

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
	const { members, expenses, monthlyRent, daysInMonth, monthlyDeposit } = input;

	const totalMeals = members.reduce((sum, m) => sum + m.mealCount, 0);

	const groceryPaisa = expenses
		.filter((e) => e.type === "GROCERY")
		.reduce((sum, e) => sum + toPaisa(e.amount), 0);

	const mealRate =
		totalMeals > 0 ? Number((toTaka(groceryPaisa) / totalMeals).toFixed(4)) : 0;

	const sharedExpenses = expenses.filter(
		(e) => e.type !== "GROCERY" && e.type !== "RENT",
	);

	const mealShares = allocate(
		groceryPaisa,
		members.map((m) => m.mealCount),
	);

	const sharedShares = members.map(() => 0);
	const sharedByType = members.map(() => new Map<ExpenseType, number>());

	for (const expense of sharedExpenses) {
		const weights =
			expense.splitMethod === "BY_MEAL"
				? members.map((m) => m.mealCount)
				: members.map(() => 1);

		const usable = weights.some((w) => w > 0) ? weights : members.map(() => 1);

		const parts = allocate(toPaisa(expense.amount), usable);
		parts.forEach((part, index) => {
			sharedShares[index]! += part;

			const bucket = sharedByType[index]!;
			bucket.set(expense.type, (bucket.get(expense.type) ?? 0) + part);
		});
	}

	const dayWeights = members.map((m) => Math.min(m.daysPresent, daysInMonth));

	const usableDayWeights = dayWeights.some((d) => d > 0)
		? dayWeights
		: members.map(() => 1);

	const rentShares = allocate(toPaisa(monthlyRent), usableDayWeights);

	const bills: SettlementBill[] = members.map((member, index) => {
		const mealCost = mealShares[index]!;
		const sharedCost = sharedShares[index]!;
		const rentShare = rentShares[index]!;
		const openingBalance = toPaisa(member.openingBalance);
		const advanceCharged = toPaisa(monthlyDeposit);

		const totalPayable =
			openingBalance + mealCost + sharedCost + rentShare + advanceCharged;

		const creditAmount =
			toPaisa(member.depositTotal) + toPaisa(member.paidExpenseTotal);

		const sharedBreakdown = [...sharedByType[index]!.entries()]
			.filter(([, paisa]) => paisa !== 0)
			.sort(
				(a, b) =>
					SHARED_TYPE_ORDER.indexOf(a[0]) - SHARED_TYPE_ORDER.indexOf(b[0]),
			)
			.map(([type, paisa]) => ({ type, amount: toTaka(paisa) }));

		return {
			memberId: member.memberId,
			openingBalance: toTaka(openingBalance),
			mealCount: member.mealCount,
			mealCost: toTaka(mealCost),
			sharedCost: toTaka(sharedCost),
			sharedBreakdown,
			rentShare: toTaka(rentShare),
			advanceCharged: toTaka(advanceCharged),
			totalPayable: toTaka(totalPayable),
			depositTotal: member.depositTotal,
			paidExpenseTotal: member.paidExpenseTotal,
			creditAmount: toTaka(creditAmount),

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

export type FundGroceryCheckInput = {
	depositTotal: number;
	expenses: { type: ExpenseType; paidByMemberId: string | null }[];
};

export const depositFundedGroceryWarning = (
	input: FundGroceryCheckInput,
): string | null => {
	if (input.depositTotal <= 0) {
		return null;
	}

	const fundBoughtGroceries = input.expenses.some(
		(expense) => expense.type === "GROCERY" && !expense.paidByMemberId,
	);

	if (fundBoughtGroceries) {
		return null;
	}

	return "Members Deposited Money This Cycle But No Grocery Expense Was Recorded Against The Mess Fund. If The Fund Bought Groceries, Add Them As A Grocery Expense With No Payer, Otherwise The Meal Rate Will Come Out Too Low.";
};
