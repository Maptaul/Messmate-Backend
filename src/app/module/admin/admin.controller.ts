import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AdminServices } from "./admin.service";

const getAllUsers = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AdminServices.getAllUsers(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users Retrieved Successfully",
		data,
		meta,
	});
});

const getSingleUser = catchAsync(async (req: Request, res: Response) => {
	const userId = req.params.userId as string;

	const result = await AdminServices.getSingleUser(userId);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Retrieved Successfully",
		data: result,
	});
});

const changeUserRole = catchAsync(async (req: Request, res: Response) => {
	const userId = req.params.userId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await AdminServices.changeUserRole(userId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Role Changed Successfully",
		data: result,
	});
});

const changeUserStatus = catchAsync(async (req: Request, res: Response) => {
	const userId = req.params.userId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await AdminServices.changeUserStatus(userId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Status Changed Successfully",
		data: result,
	});
});

const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AdminServices.getAuditLogs(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Audit Logs Retrieved Successfully",
		data,
		meta,
	});
});

const getDashboardStats = catchAsync(async (_req: Request, res: Response) => {
	const result = await AdminServices.getDashboardStats();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Dashboard Stats Retrieved Successfully",
		data: result,
	});
});

export const AdminController = {
	getAllUsers,
	getSingleUser,
	changeUserRole,
	changeUserStatus,
	getAuditLogs,
	getDashboardStats,
};
