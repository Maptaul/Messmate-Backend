export interface IPlanDayInput {
	date: Date;
	lunch: number;
	dinner: number;
}

export interface ISetMealPlanPayload {
	cycleId: string;

	memberId?: string;
	days: IPlanDayInput[];
}

export interface IApplyPlanPayload {
	cycleId: string;
	date: Date;
}
