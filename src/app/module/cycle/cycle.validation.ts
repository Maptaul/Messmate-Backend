import z from "zod";

const OpenCycleValidationZodSchema = z.object({
	messId: z.string().min(1, "Mess Id Is Required"),
	year: z.coerce
		.number("Year Must Be A Number")
		.int("Year Must Be A Whole Number")
		.min(2000, "Year Is Too Far In The Past")
		.max(2100, "Year Is Too Far In The Future"),
	month: z.coerce
		.number("Month Must Be A Number")
		.int("Month Must Be A Whole Number")
		.min(1, "Month Must Be Between 1 And 12")
		.max(12, "Month Must Be Between 1 And 12"),
});

export const CycleValidation = {
	OpenCycleValidationZodSchema,
};
