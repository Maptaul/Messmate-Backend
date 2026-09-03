import type { Role } from "../../../generated/prisma/enums";

export interface IRegisterUserPayload {
	name: string;
	email: string;
	password: string;
	phone?: string;
	role?: "MESS_MANAGER" | "MEMBER";
}

export interface ILoginUserPayload {
	email: string;
	password: string;
}

export interface IGoogleLoginPayload {
	idToken: string;
}

export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}
