import z from "zod";
import { Role, UserStatus } from "../../../generated/prisma/enums";

const ChangeRoleValidationZodSchema = z.object({
	role: z.enum(
		[Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER],
		"Role Must Be ADMIN, MESS_MANAGER Or MEMBER",
	),
});

const ChangeStatusValidationZodSchema = z.object({
	status: z.enum(
		[UserStatus.ACTIVE, UserStatus.BLOCKED],
		"Status Must Be ACTIVE Or BLOCKED",
	),
});

export const AdminValidation = {
	ChangeRoleValidationZodSchema,
	ChangeStatusValidationZodSchema,
};
