export interface IRequestToJoinPayload {
	joinCode: string;
	note?: string;
}

export interface IInviteMemberPayload {
	messId: string;
	email: string;
}
