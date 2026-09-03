import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { MealServices } from "./meal.service";

const addDailyMeals = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await MealServices.addDailyMeals(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Daily Meals Recorded Successfully",
		data: result,
	});
});

const getCycleMeals = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const { data, meta } = await MealServices.getCycleMeals(
		cycleId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meals Retrieved Successfully",
		data,
		meta,
	});
});

const getMealSummary = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await MealServices.getMealSummary(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal Summary Retrieved Successfully",
		data: result,
	});
});

const updateMeal = catchAsync(async (req: Request, res: Response) => {
	const mealId = req.params.mealId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await MealServices.updateMeal(mealId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal Entry Updated Successfully",
		data: result,
	});
});

const deleteMeal = catchAsync(async (req: Request, res: Response) => {
	const mealId = req.params.mealId as string;
	const user = req.user!;

	const result = await MealServices.deleteMeal(mealId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal Entry Deleted Successfully",
		data: result,
	});
});

export const MealController = {
	addDailyMeals,
	getCycleMeals,
	getMealSummary,
	updateMeal,
	deleteMeal,
};
