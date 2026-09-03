import type { Role } from "../../../generated/prisma/enums";

export interface IRegisterUserPayload {
	name: string;
	email: string;
	password: string;
	phone?: string;
	role?: "MESS_MANAGER" | "MEMBER";
}

export interface IVerifyEmailPayload {
	email: string;
	otp: string;
}

export interface ILoginUserPayload {
	email: string;
	password: string;
}

export interface IGoogleLoginPayload {
	idToken: string;
}

export interface IForgotPasswordPayload {
	email: string;
}

export interface IResetPasswordPayload {
	email: string;
	newPassword: string;
	otp: string;
}

export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}
