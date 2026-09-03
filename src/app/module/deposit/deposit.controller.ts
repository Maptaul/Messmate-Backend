import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { DepositServices } from "./deposit.service";

const addDeposit = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await DepositServices.addDeposit(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Deposit Recorded Successfully",
		data: result,
	});
});

const getCycleDeposits = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const { data, meta } = await DepositServices.getCycleDeposits(
		cycleId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Deposits Retrieved Successfully",
		data,
		meta,
	});
});

const updateDeposit = catchAsync(async (req: Request, res: Response) => {
	const depositId = req.params.depositId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await DepositServices.updateDeposit(depositId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Deposit Updated Successfully",
		data: result,
	});
});

const deleteDeposit = catchAsync(async (req: Request, res: Response) => {
	const depositId = req.params.depositId as string;
	const user = req.user!;

	const result = await DepositServices.deleteDeposit(depositId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Deposit Deleted Successfully",
		data: result,
	});
});

export const DepositController = {
	addDeposit,
	getCycleDeposits,
	updateDeposit,
	deleteDeposit,
};
