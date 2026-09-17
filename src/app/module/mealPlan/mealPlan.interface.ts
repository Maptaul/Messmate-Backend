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

export interface ISetDefaultMealsPayload {
	messId: string;

	memberId?: string;
	lunch: number;
	dinner: number;
}

export interface IApplyPlanPayload {
	cycleId: string;
	date: Date;
}
