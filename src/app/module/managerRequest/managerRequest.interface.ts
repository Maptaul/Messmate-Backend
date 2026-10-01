import type { ManagerApplicationStatus } from "../../../generated/prisma/enums";

export interface IApplyForManagerPayload {
	messName: string;
	messAddress: string;
}

export interface IReviewManagerRequestPayload {
	requestId: string;
	status: Exclude<ManagerApplicationStatus, "PENDING">;
	rejectionReason?: string;
}
