import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { GroceryDutyServices } from "./groceryDuty.service";

const assignDuty = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await GroceryDutyServices.assignDuty(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Grocery Duty Assigned Successfully",
		data: result,
	});
});

const getCycleDuties = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await GroceryDutyServices.getCycleDuties(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Grocery Duties Retrieved Successfully",
		data: result,
	});
});

const getCycleCalendar = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await GroceryDutyServices.getCycleCalendar(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Grocery Duty Calendar Retrieved Successfully",
		data: result,
	});
});

const getMyDutyDays = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await GroceryDutyServices.getMyDutyDays(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "My Grocery Duty Days Retrieved Successfully",
		data: result,
	});
});

const updateDuty = catchAsync(async (req: Request, res: Response) => {
	const dutyId = req.params.dutyId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await GroceryDutyServices.updateDuty(dutyId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Grocery Duty Updated Successfully",
		data: result,
	});
});

const removeDuty = catchAsync(async (req: Request, res: Response) => {
	const dutyId = req.params.dutyId as string;
	const user = req.user!;

	const result = await GroceryDutyServices.removeDuty(dutyId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Grocery Duty Removed Successfully",
		data: result,
	});
});

export const GroceryDutyController = {
	assignDuty,
	getCycleDuties,
	getCycleCalendar,
	getMyDutyDays,
	updateDuty,
	removeDuty,
};
