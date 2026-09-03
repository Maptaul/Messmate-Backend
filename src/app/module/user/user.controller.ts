import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { UserServices } from "./user.service";

const updateProfile = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await UserServices.updateProfile(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile Updated Successfully",
		data: result,
	});
});

const updateProfileImage = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await UserServices.updateProfileImage(req.file, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile Image Updated Successfully",
		data: result,
	});
});

const removeProfileImage = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await UserServices.removeProfileImage(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile Image Removed Successfully",
		data: result,
	});
});

export const UserController = {
	updateProfile,
	updateProfileImage,
	removeProfileImage,
};
