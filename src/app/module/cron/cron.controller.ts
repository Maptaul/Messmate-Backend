import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { CronServices } from "./cron.service";

const isDryRun = (req: Request) => req.query.dryRun === "true";

const mealPlanReminder = catchAsync(async (req: Request, res: Response) => {
	const result = await CronServices.sendMealPlanReminders(isDryRun(req));

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Meal Plan Reminders Processed",
		data: result,
	});
});

const unpaidBillReminder = catchAsync(async (req: Request, res: Response) => {
	const result = await CronServices.sendUnpaidBillReminders(isDryRun(req));

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Unpaid Bill Reminders Processed",
		data: result,
	});
});

export const CronController = {
	mealPlanReminder,
	unpaidBillReminder,
};
