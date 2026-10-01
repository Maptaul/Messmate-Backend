import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { MembershipServices } from "./membership.service";

const previewJoinCode = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.previewJoinCode(
		req.params.code as string,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Mess Found",
		data: result,
	});
});

const requestToJoin = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.requestToJoin(req.body, req.user!);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Request Sent To The Manager",
		data: result,
	});
});

const inviteMember = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.inviteMember(req.body, req.user!);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Invitation Sent",
		data: result,
	});
});

const getMyRequests = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.getMyRequests(req.user!);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Invitations And Requests Retrieved Successfully",
		data: result,
	});
});

const getMessRequests = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await MembershipServices.getMessRequests(
		req.params.messId as string,
		req.query,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Invitations And Requests Retrieved Successfully",
		data,
		meta,
	});
});

const accept = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.accept(
		req.params.id as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Accepted",
		data: result,
	});
});

const decline = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.decline(
		req.params.id as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Declined",
		data: result,
	});
});

const cancel = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.cancel(
		req.params.id as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Withdrawn",
		data: result,
	});
});

const regenerateJoinCode = catchAsync(async (req: Request, res: Response) => {
	const result = await MembershipServices.regenerateJoinCode(
		req.params.messId as string,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New Join Code Created",
		data: result,
	});
});

export const MembershipController = {
	previewJoinCode,
	requestToJoin,
	inviteMember,
	getMyRequests,
	getMessRequests,
	accept,
	decline,
	cancel,
	regenerateJoinCode,
};
