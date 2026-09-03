export interface IMealEntryInput {
	memberId: string;
	lunch: number;
	dinner: number;
}

export interface IAddDailyMealsPayload {
	cycleId: string;
	date: Date;
	entries: IMealEntryInput[];
}

export interface IUpdateMealPayload {
	lunch?: number;
	dinner?: number;
}
