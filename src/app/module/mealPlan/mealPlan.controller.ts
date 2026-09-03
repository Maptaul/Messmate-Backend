import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { MealPlanServices } from "./mealPlan.service";

const setMealPlan = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await MealPlanServices.setMealPlan(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Meal Plan Saved Successfully",
		data: result,
	});
});

const getMyCalendar = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await MealPlanServices.getMyCalendar(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal Calendar Retrieved Successfully",
		data: result,
	});
});

const getCycleCalendar = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await MealPlanServices.getCycleCalendar(
		cycleId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Cycle Meal Calendar Retrieved Successfully",
		data: result,
	});
});

const applyPlanToRegister = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await MealPlanServices.applyPlanToRegister(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.message,
		data: result,
	});
});

export const MealPlanController = {
	setMealPlan,
	getMyCalendar,
	getCycleCalendar,
	applyPlanToRegister,
};
