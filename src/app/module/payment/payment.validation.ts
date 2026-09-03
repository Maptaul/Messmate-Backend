import z from "zod";

const CreatePaymentValidationZodSchema = z.object({
	billId: z.string().min(1, "Bill Id Is Required"),
});

export const PaymentValidation = {
	CreatePaymentValidationZodSchema,
};
