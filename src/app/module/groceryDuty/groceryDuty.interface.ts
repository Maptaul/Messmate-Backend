export interface IAssignDutyPayload {
	cycleId: string;
	memberId: string;
	startDate: Date;
	endDate: Date;
	note?: string;
}

export interface IUpdateDutyPayload {
	memberId?: string;
	startDate?: Date;
	endDate?: Date;
	note?: string;
}
