import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ManagerRequestServices } from "./managerRequest.service";

const applyForManager = catchAsync(async (req: Request, res: Response) => {
	const result = await ManagerRequestServices.applyForManager(
		req.body,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Request Sent To The Admin",
		data: result,
	});
});

const getAllRequests = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await ManagerRequestServices.getAllRequests(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Manager Requests Retrieved Successfully",
		data,
		meta,
	});
});

const reviewRequest = catchAsync(async (req: Request, res: Response) => {
	const result = await ManagerRequestServices.reviewRequest(
		req.body,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Manager Request Reviewed Successfully",
		data: result,
	});
});

export const ManagerRequestController = {
	applyForManager,
	getAllRequests,
	reviewRequest,
};
