import z from "zod";

const AssignDutyValidationZodSchema = z
	.object({
		cycleId: z.string().min(1, "Cycle Id Is Required"),
		memberId: z.string().min(1, "Member Id Is Required"),
		startDate: z.coerce.date("A Valid Start Date Is Required"),
		endDate: z.coerce.date("A Valid End Date Is Required"),
		note: z.string().max(300, "Note Is Too Long").optional(),
	})
	.refine((data) => data.endDate >= data.startDate, {
		message: "End Date Cannot Be Before Start Date",
		path: ["endDate"],
	});

const UpdateDutyValidationZodSchema = z
	.object({
		memberId: z.string().min(1, "Member Id Is Required").optional(),
		startDate: z.coerce.date().optional(),
		endDate: z.coerce.date().optional(),
		note: z.string().max(300, "Note Is Too Long").optional(),
	})
	.refine(
		(data) =>
			!data.startDate || !data.endDate || data.endDate >= data.startDate,
		{ message: "End Date Cannot Be Before Start Date", path: ["endDate"] },
	);

export const GroceryDutyValidation = {
	AssignDutyValidationZodSchema,
	UpdateDutyValidationZodSchema,
};
