import z from "zod";
import { JOIN_CODE_PATTERN, normalizeJoinCode } from "./membership.rules";

export const joinCodeSchema = z
	.string("Join Code Must Be A String")
	.transform(normalizeJoinCode)
	.pipe(
		z
			.string()
			.regex(JOIN_CODE_PATTERN, "Join Code Must Be 6 Letters Or Digits"),
	);

const RequestToJoinValidationZodSchema = z.object({
	joinCode: joinCodeSchema,
	note: z
		.string("Note Must Be A String")
		.trim()
		.max(300, "Note Is Too Long")
		.optional(),
});

const InviteMemberValidationZodSchema = z.object({
	messId: z.string().min(1, "Mess Id Is Required"),
	email: z.email("Not a valid email"),
});

export const MembershipValidation = {
	RequestToJoinValidationZodSchema,
	InviteMemberValidationZodSchema,
};
