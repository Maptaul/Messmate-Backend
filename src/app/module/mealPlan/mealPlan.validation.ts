import z from "zod";

const mealCountSchema = z.coerce
	.number("Meal Count Must Be A Number")
	.int("Meal Count Must Be A Whole Number")
	.min(0, "Meal Count Cannot Be Negative")
	.max(10, "Meal Count Is Too High");

const SetMealPlanValidationZodSchema = z.object({
	cycleId: z.string().min(1, "Cycle Id Is Required"),

	memberId: z.string().optional(),
	days: z
		.array(
			z.object({
				date: z.coerce.date("A Valid Date Is Required"),
				lunch: mealCountSchema.default(0),
				dinner: mealCountSchema.default(0),
			}),
		)
		.min(1, "At Least One Day Is Required")
		.max(31, "A Plan Cannot Cover More Than 31 Days"),
});

const ApplyPlanValidationZodSchema = z.object({
	cycleId: z.string().min(1, "Cycle Id Is Required"),
	date: z.coerce.date("A Valid Date Is Required"),
});

export const MealPlanValidation = {
	SetMealPlanValidationZodSchema,
	ApplyPlanValidationZodSchema,
};
