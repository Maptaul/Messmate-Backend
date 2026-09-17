import z from "zod";

const entryTypeSchema = z.enum(
	["INCOME", "EXPENSE"],
	"Type Must Be INCOME Or EXPENSE",
);

const categorySchema = z.enum(
	[
		"SALARY",
		"TUITION",
		"FAMILY",
		"BUSINESS",
		"FOOD",
		"MESS",
		"TRANSPORT",
		"EDUCATION",
		"MOBILE_INTERNET",
		"HEALTH",
		"SHOPPING",
		"ENTERTAINMENT",
		"OTHER",
	],
	"Invalid Category",
);

const amountSchema = z.coerce
	.number("Amount Must Be A Number")
	.positive("Amount Must Be Greater Than Zero")
	.multipleOf(0.01, "Amount Can Have At Most Two Decimals")
	.max(10000000, "Amount Is Too Large");

const noteSchema = z.string().trim().max(300, "Note Is Too Long");

const AddFinanceEntryValidationZodSchema = z.object({
	type: entryTypeSchema,
	category: categorySchema,
	amount: amountSchema,
	date: z.coerce.date("A Valid Date Is Required").optional(),
	note: noteSchema.optional(),
});

const UpdateFinanceEntryValidationZodSchema = z.object({
	type: entryTypeSchema.optional(),
	category: categorySchema.optional(),
	amount: amountSchema.optional(),
	date: z.coerce.date("A Valid Date Is Required").optional(),
	note: noteSchema.optional(),
});

export const FinanceValidation = {
	AddFinanceEntryValidationZodSchema,
	UpdateFinanceEntryValidationZodSchema,
};
