import z from "zod";

const UpdateProfileValidationZodSchema = z.object({
	name: z
		.string()
		.min(3, "Name must atleast 3 characters long!!!")
		.max(120, "Name Is Too Long")
		.optional(),
	phone: z.string().max(20, "Phone Number Is Too Long").optional(),
});

export const UserValidation = {
	UpdateProfileValidationZodSchema,
};
