import z from "zod";
import {
	messAddressSchema,
	messNameSchema,
} from "../managerRequest/managerRequest.validation";

const passwordSchema = z
	.string()
	.min(8, "Password Must Minimum 8 Characters Long.")
	.regex(/[a-z]/, "Password must contain atleast 1 Lowercase Letter")
	.regex(/[A-Z]/, "Password must contain atleast 1 Uppercase Letter")
	.regex(/[0-9]/, "Password must contain atleast 1 Number")
	.regex(/[^A-Za-z0-9]/, "Password must contain atleast 1 Special Character");

const RegisterUserZodSchema = z
	.object({
		name: z
			.string("Name Must Be A String")
			.min(3, "Name must atleast 3 characters long!!!")
			.max(120, "Name Is Too Long"),
		email: z.email("Not a valid email"),
		password: passwordSchema,
		phone: z.string().max(20, "Phone Number Is Too Long").optional(),

		role: z
			.enum(["MESS_MANAGER", "MEMBER"], "Role Must Be MESS_MANAGER Or MEMBER")
			.optional(),

		// Asking to run a mess sends these to an admin, who approves the request.
		messName: messNameSchema.optional(),
		messAddress: messAddressSchema.optional(),
	})
	.superRefine((value, ctx) => {
		if (value.role !== "MESS_MANAGER") return;

		if (!value.messName) {
			ctx.addIssue({
				code: "custom",
				path: ["messName"],
				message: "Mess Name Is Required To Run A Mess",
			});
		}

		if (!value.messAddress) {
			ctx.addIssue({
				code: "custom",
				path: ["messAddress"],
				message: "Address Is Required To Run A Mess",
			});
		}
	});

const VerifyEmailZodSchema = z.object({
	email: z.email("Not a valid email"),
	otp: z.string().length(6, "OTP Must Be 6 Digits"),
});

const LoginZodSchema = z.object({
	email: z.email("Not a valid email"),
	password: passwordSchema,
});

const GoogleLoginZodSchema = z.object({
	idToken: z.string().min(1, "Google Id Token Is Required"),
});

const ForgotPasswordZodSchema = z.object({
	email: z.email("Not a valid email"),
});

const ResetPasswordZodSchema = z.object({
	email: z.email("Not a valid email"),
	newPassword: passwordSchema,
	otp: z.string().length(6, "OTP Must Be 6 Digits"),
});

export const AuthValidation = {
	RegisterUserZodSchema,
	VerifyEmailZodSchema,
	LoginZodSchema,
	GoogleLoginZodSchema,
	ForgotPasswordZodSchema,
	ResetPasswordZodSchema,
};
