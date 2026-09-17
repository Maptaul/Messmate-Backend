import type {
	FinanceCategory,
	FinanceEntryType,
} from "../../../generated/prisma/enums";

export interface IAddFinanceEntryPayload {
	type: FinanceEntryType;
	category: FinanceCategory;
	amount: number;
	date?: Date;
	note?: string;
}

export interface IUpdateFinanceEntryPayload {
	type?: FinanceEntryType;
	category?: FinanceCategory;
	amount?: number;
	date?: Date;
	note?: string;
}
