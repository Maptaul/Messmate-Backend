import z from "zod";

const passwordSchema = z
	.string()
	.min(8, "Password Must Minimum 8 Characters Long.")
	.regex(/[a-z]/, "Password must contain atleast 1 Lowercase Letter")
	.regex(/[A-Z]/, "Password must contain atleast 1 Uppercase Letter")
	.regex(/[0-9]/, "Password must contain atleast 1 Number")
	.regex(/[^A-Za-z0-9]/, "Password must contain atleast 1 Special Character");

const RegisterUserZodSchema = z.object({
	name: z
		.string("Name Must Be A String")
		.min(3, "Name must atleast 3 characters long!!!")
		.max(120, "Name Is Too Long"),
	email: z.email("Not a valid email"),
	password: passwordSchema,
	phone: z.string().max(20, "Phone Number Is Too Long").optional(),
	// ADMIN is deliberately absent: it is seeded, never self-registered.
	role: z.enum(["MESS_MANAGER", "MEMBER"], "Role Must Be MESS_MANAGER Or MEMBER").optional(),
});

const LoginZodSchema = z.object({
	email: z.email("Not a valid email"),
	password: passwordSchema,
});

const GoogleLoginZodSchema = z.object({
	idToken: z.string().min(1, "Google Id Token Is Required"),
});

export const AuthValidation = {
	RegisterUserZodSchema,
	LoginZodSchema,
	GoogleLoginZodSchema,
};
