import z from "zod";

const CreateMessValidationZodSchema = z.object({
	name: z
		.string("Mess Name Must Be A String")
		.min(3, "Mess Name Must Atleast 3 Characters Long")
		.max(120, "Mess Name Is Too Long"),
	address: z
		.string("Address Must Be A String")
		.min(3, "Address Must Atleast 3 Characters Long")
		.max(300, "Address Is Too Long"),
	monthlyRent: z.coerce
		.number("Monthly Rent Must Be A Number")
		.positive("Monthly Rent Must Be Greater Than Zero")
		.max(1000000, "Monthly Rent Is Too Large"),
	monthlyDeposit: z.coerce
		.number("Monthly Deposit Must Be A Number")
		.min(0, "Monthly Deposit Cannot Be Negative")
		.max(1000000, "Monthly Deposit Is Too Large")
		.optional(),
});

const UpdateMessValidationZodSchema = z.object({
	name: z
		.string()
		.min(3, "Mess Name Must Atleast 3 Characters Long")
		.max(120)
		.optional(),
	address: z
		.string()
		.min(3, "Address Must Atleast 3 Characters Long")
		.max(300)
		.optional(),
	monthlyRent: z.coerce
		.number()
		.positive("Monthly Rent Must Be Greater Than Zero")
		.max(1000000)
		.optional(),
	monthlyDeposit: z.coerce
		.number()
		.min(0, "Monthly Deposit Cannot Be Negative")
		.max(1000000)
		.optional(),
});

export const MessValidation = {
	CreateMessValidationZodSchema,
	UpdateMessValidationZodSchema,
};
