import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { CycleServices } from "./cycle.service";

const openCycle = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await CycleServices.openCycle(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Billing Cycle Opened Successfully",
		data: result,
	});
});

const getMessCycles = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const { data, meta } = await CycleServices.getMessCycles(
		messId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Billing Cycles Retrieved Successfully",
		data,
		meta,
	});
});

const getSingleCycle = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await CycleServices.getSingleCycle(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Billing Cycle Retrieved Successfully",
		data: result,
	});
});

const closeCycle = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await CycleServices.closeCycle(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Billing Cycle Closed And Bills Generated Successfully",
		data: result,
	});
});

const reopenCycle = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await CycleServices.reopenCycle(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Billing Cycle Reopened Successfully",
		data: result,
	});
});

export const CycleController = {
	openCycle,
	getMessCycles,
	getSingleCycle,
	closeCycle,
	reopenCycle,
};
