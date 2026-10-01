import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { MemberServices } from "./member.service";

const getMessMembers = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const { data, meta } = await MemberServices.getMessMembers(
		messId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Mess Members Retrieved Successfully",
		data,
		meta,
	});
});

const getMyMemberships = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await MemberServices.getMyMemberships(req.query, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "My Memberships Retrieved Successfully",
		data,
		meta,
	});
});

const removeMember = catchAsync(async (req: Request, res: Response) => {
	const memberId = req.params.memberId as string;
	const user = req.user!;

	const result = await MemberServices.removeMember(memberId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Member Removed Successfully",
		data: result,
	});
});

const leaveMess = catchAsync(async (req: Request, res: Response) => {
	const messId = req.params.messId as string;
	const user = req.user!;

	const result = await MemberServices.leaveMess(messId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "You Left The Mess",
		data: result,
	});
});

export const MemberController = {
	leaveMess,
	getMessMembers,
	getMyMemberships,
	removeMember,
};
