import z from "zod";

const mealCountSchema = z.coerce
	.number("Meal Count Must Be A Number")
	.int("Meal Count Must Be A Whole Number")
	.min(0, "Meal Count Cannot Be Negative")
	.max(10, "Meal Count Is Too High");

const AddDailyMealsValidationZodSchema = z.object({
	cycleId: z.string().min(1, "Cycle Id Is Required"),
	date: z.coerce.date("A Valid Date Is Required"),
	entries: z
		.array(
			z.object({
				memberId: z.string().min(1, "Member Id Is Required"),
				lunch: mealCountSchema.default(0),
				dinner: mealCountSchema.default(0),
			}),
		)
		.min(1, "At Least One Member Entry Is Required")
		.max(100, "Too Many Entries In One Request"),
});

const UpdateMealValidationZodSchema = z.object({
	lunch: mealCountSchema.optional(),
	dinner: mealCountSchema.optional(),
});

export const MealValidation = {
	AddDailyMealsValidationZodSchema,
	UpdateMealValidationZodSchema,
};
