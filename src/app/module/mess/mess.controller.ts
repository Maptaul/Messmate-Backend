import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { MessServices } from "./mess.service";

const createMess = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await MessServices.createMess(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Mess Created Successfully",
		data: result,
	});
});

const getAllMesses = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await MessServices.getAllMesses(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Messes Retrieved Successfully",
		data,
		meta,
	});
});

const getMyMesses = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await MessServices.getMyMesses(req.query, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "My Messes Retrieved Successfully",
		data,
		meta,
	});
});

const getSingleMess = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const result = await MessServices.getSingleMess(messId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Mess Retrieved Successfully",
		data: result,
	});
});

const getMessAuditLogs = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const { data, meta } = await MessServices.getMessAuditLogs(
		messId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Mess Audit Trail Retrieved Successfully",
		data,
		meta,
	});
});

const getUnreadActivity = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const result = await MessServices.getUnreadActivity(messId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Unread Activity Retrieved Successfully",
		data: result,
	});
});

const markActivitySeen = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const result = await MessServices.markActivitySeen(messId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Activity Marked As Seen",
		data: result,
	});
});

const updateMess = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await MessServices.updateMess(messId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Mess Updated Successfully",
		data: result,
	});
});

const deleteMess = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const result = await MessServices.deleteMess(messId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Mess Deleted Successfully",
		data: result,
	});
});

export const MessController = {
	createMess,
	getAllMesses,
	getMyMesses,
	getSingleMess,
	getMessAuditLogs,
	getUnreadActivity,
	markActivitySeen,
	updateMess,
	deleteMess,
};
