import z from "zod";

const amountSchema = z.coerce
	.number("Amount Must Be A Number")
	.positive("Amount Must Be Greater Than Zero")
	.max(1000000, "Amount Is Too Large");

const AddDepositValidationZodSchema = z.object({
	cycleId: z.string().min(1, "Cycle Id Is Required"),
	memberId: z.string().min(1, "Member Id Is Required"),
	amount: amountSchema,
	note: z.string().max(500, "Note Is Too Long").optional(),
});

const UpdateDepositValidationZodSchema = z.object({
	amount: amountSchema.optional(),
	note: z.string().max(500, "Note Is Too Long").optional(),
});

export const DepositValidation = {
	AddDepositValidationZodSchema,
	UpdateDepositValidationZodSchema,
};
