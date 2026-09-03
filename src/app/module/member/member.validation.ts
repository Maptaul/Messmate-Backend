import z from "zod";

const AddMemberValidationZodSchema = z.object({
	messId: z.string().min(1, "Mess Id Is Required"),
	email: z.email("Not a valid email"),
});

export const MemberValidation = {
	AddMemberValidationZodSchema,
};
