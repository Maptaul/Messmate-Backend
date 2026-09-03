export interface IAddDepositPayload {
	cycleId: string;
	memberId: string;
	amount: number;
	note?: string;
}

export interface IUpdateDepositPayload {
	amount?: number;
	note?: string;
}
