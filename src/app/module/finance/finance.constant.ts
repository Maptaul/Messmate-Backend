import {
	FinanceCategory,
	type FinanceEntryType,
} from "../../../generated/prisma/enums";

export const FINANCE_CATEGORIES: Record<FinanceEntryType, FinanceCategory[]> = {
	INCOME: [
		FinanceCategory.SALARY,
		FinanceCategory.TUITION,
		FinanceCategory.FAMILY,
		FinanceCategory.BUSINESS,
		FinanceCategory.OTHER,
	],
	EXPENSE: [
		FinanceCategory.FOOD,
		FinanceCategory.MESS,
		FinanceCategory.TRANSPORT,
		FinanceCategory.EDUCATION,
		FinanceCategory.MOBILE_INTERNET,
		FinanceCategory.HEALTH,
		FinanceCategory.SHOPPING,
		FinanceCategory.ENTERTAINMENT,
		FinanceCategory.OTHER,
	],
};

export const categoryFits = (
	type: FinanceEntryType,
	category: FinanceCategory,
) => FINANCE_CATEGORIES[type].includes(category);

export const FINANCE_PERIODS = [
	"daily",
	"weekly",
	"monthly",
	"yearly",
] as const;

export type TFinancePeriod = (typeof FINANCE_PERIODS)[number];
