import z from "zod";

const CreatePaymentValidationZodSchema = z.object({
	billId: z.string().min(1, "Bill Id Is Required"),
});

const ConfirmStripePaymentValidationZodSchema = z.object({
	sessionId: z.string().min(1, "Session Id Is Required"),
});

const RecordCashPaymentValidationZodSchema = z.object({
	billId: z.string().min(1, "Bill Id Is Required"),
	amount: z.coerce
		.number("Amount Must Be A Number")
		.positive("Amount Must Be More Than Zero")
		.max(1000000, "Amount Is Too Large"),
	note: z.string().max(200, "Note Is Too Long").optional(),
});

export const PaymentValidation = {
	CreatePaymentValidationZodSchema,
	ConfirmStripePaymentValidationZodSchema,
	RecordCashPaymentValidationZodSchema,
};
