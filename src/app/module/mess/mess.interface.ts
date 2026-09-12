export interface ICreateMessPayload {
	name: string;
	address: string;
	monthlyRent: number;
	monthlyDeposit?: number;
}

export interface IUpdateMessPayload {
	name?: string;
	address?: string;
	monthlyRent?: number;
	monthlyDeposit?: number;
}
