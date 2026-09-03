export interface IPlanDayInput {
	date: Date;
	lunch: number;
	dinner: number;
}

export interface ISetMealPlanPayload {
	cycleId: string;
	/** Omitted by a member planning for themselves; a manager may name someone. */
	memberId?: string;
	days: IPlanDayInput[];
}

export interface IApplyPlanPayload {
	cycleId: string;
	date: Date;
}
