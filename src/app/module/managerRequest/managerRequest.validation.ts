import z from "zod";
import { ManagerApplicationStatus } from "../../../generated/prisma/enums";

// The same limits a mess has once it is created.
export const messNameSchema = z
	.string("Mess Name Must Be A String")
	.trim()
	.min(3, "Mess Name Must Atleast 3 Characters Long")
	.max(120, "Mess Name Is Too Long");

export const messAddressSchema = z
	.string("Address Must Be A String")
	.trim()
	.min(3, "Address Must Atleast 3 Characters Long")
	.max(300, "Address Is Too Long");

const ApplyForManagerValidationZodSchema = z.object({
	messName: messNameSchema,
	messAddress: messAddressSchema,
});

const ReviewManagerRequestValidationZodSchema = z
	.object({
		requestId: z.uuid("Request Id Must Be A Valid Id"),
		status: z.enum(
			[ManagerApplicationStatus.APPROVED, ManagerApplicationStatus.REJECTED],
			"Status Must Be APPROVED Or REJECTED",
		),
		rejectionReason: z
			.string("Reason Must Be A String")
			.trim()
			.max(500, "Reason Is Too Long")
			.optional(),
	})
	.superRefine((value, ctx) => {
		if (value.status === "REJECTED" && !value.rejectionReason) {
			ctx.addIssue({
				code: "custom",
				path: ["rejectionReason"],
				message: "Give A Reason When Rejecting A Request",
			});
		}
	});

export const ManagerRequestValidation = {
	ApplyForManagerValidationZodSchema,
	ReviewManagerRequestValidationZodSchema,
};
