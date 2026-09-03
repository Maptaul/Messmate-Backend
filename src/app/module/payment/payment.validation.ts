import z from "zod";

// Only the bill id. The amount is read from the bill row inside the service -
// an amount arriving from the client is how a member pays 1 taka for a 4000
// taka bill.
const CreatePaymentValidationZodSchema = z.object({
	billId: z.string().min(1, "Bill Id Is Required"),
});

export const PaymentValidation = {
	CreatePaymentValidationZodSchema,
};
