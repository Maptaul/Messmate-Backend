import type { Role, UserStatus } from "../../../generated/prisma/enums";

export interface IChangeRolePayload {
	role: Role;
}

export interface IChangeStatusPayload {
	status: UserStatus;
}
