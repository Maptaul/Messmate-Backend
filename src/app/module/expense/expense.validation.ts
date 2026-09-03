import z from "zod";

const expenseTypeSchema = z.enum(
	[
		"GROCERY",
		"GAS",
		"ELECTRICITY",
		"WATER",
		"INTERNET",
		"MAID",
		"RENT",
		"OTHER",
	],
	"Invalid Expense Type",
);

const splitMethodSchema = z.enum(
	["EQUAL", "BY_MEAL"],
	"Split Method Must Be EQUAL Or BY_MEAL",
);

const amountSchema = z.coerce
	.number("Amount Must Be A Number")
	.positive("Amount Must Be Greater Than Zero")
	.max(1000000, "Amount Is Too Large");

const AddExpenseValidationZodSchema = z.object({
	cycleId: z.string().min(1, "Cycle Id Is Required"),
	type: expenseTypeSchema,
	amount: amountSchema,
	splitMethod: splitMethodSchema.optional(),
	paidByMemberId: z.string().optional(),
	description: z.string().max(500, "Description Is Too Long").optional(),
	spentAt: z.coerce.date("A Valid Date Is Required"),
});

const UpdateExpenseValidationZodSchema = z.object({
	type: expenseTypeSchema.optional(),
	amount: amountSchema.optional(),
	splitMethod: splitMethodSchema.optional(),
	paidByMemberId: z.string().optional(),
	description: z.string().max(500, "Description Is Too Long").optional(),
	spentAt: z.coerce.date().optional(),
});

export const ExpenseValidation = {
	AddExpenseValidationZodSchema,
	UpdateExpenseValidationZodSchema,
};
