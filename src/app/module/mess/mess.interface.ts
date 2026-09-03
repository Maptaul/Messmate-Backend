export interface ICreateMessPayload {
	name: string;
	address: string;
	monthlyRent: number;
}

export interface IUpdateMessPayload {
	name?: string;
	address?: string;
	monthlyRent?: number;
}
