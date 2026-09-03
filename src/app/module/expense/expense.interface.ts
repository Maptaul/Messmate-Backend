import type {
	ExpenseType,
	SplitMethod,
} from "../../../generated/prisma/enums";

export interface IAddExpensePayload {
	cycleId: string;
	type: ExpenseType;
	amount: number;
	splitMethod?: SplitMethod;
	/** Who fronted the cash. Credited back to them at settlement. */
	paidByMemberId?: string;
	description?: string;
	spentAt: Date;
}

export interface IUpdateExpensePayload {
	type?: ExpenseType;
	amount?: number;
	splitMethod?: SplitMethod;
	paidByMemberId?: string;
	description?: string;
	spentAt?: Date;
}
