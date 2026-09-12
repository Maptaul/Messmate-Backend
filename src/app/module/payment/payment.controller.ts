import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { renderPaymentResult } from "./payment.result";
import { PaymentServices } from "./payment.service";

const getMyBills = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await PaymentServices.getMyBills(req.query, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Bills Retrieved Successfully",
		data,
		meta,
	});
});

const createPayment = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await PaymentServices.createPayment(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Payment Initiated Successfully",
		data: result,
	});
});

const getCycleBills = catchAsync(async (req: Request, res: Response) => {
	const { cycleId } = req.params;
	const user = req.user!;

	const { data, meta } = await PaymentServices.getCycleBills(
		cycleId as string,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Cycle Bills Retrieved Successfully",
		data,
		meta,
	});
});

const recordCashPayment = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await PaymentServices.recordCashPayment(req.body, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Cash Payment Recorded Successfully",
		data: result,
	});
});

const paymentCallback = catchAsync(async (req: Request, res: Response) => {
	const { redirectUrl } = await PaymentServices.paymentCallback(req.query);

	res.redirect(redirectUrl);
});

const paymentResult = (req: Request, res: Response) => {
	const status = typeof req.query.status === "string" ? req.query.status : "";

	res.type("html").send(renderPaymentResult(status));
};

const getMyPayments = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await PaymentServices.getMyPayments(req.query, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments Retrieved Successfully",
		data,
		meta,
	});
});

const getSinglePayment = catchAsync(async (req: Request, res: Response) => {
	const paymentId = req.params.paymentId as string;
	const user = req.user!;

	const result = await PaymentServices.getSinglePayment(paymentId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment Retrieved Successfully",
		data: result,
	});
});

export const PaymentController = {
	getMyBills,
	createPayment,
	getCycleBills,
	recordCashPayment,
	paymentCallback,
	paymentResult,
	getMyPayments,
	getSinglePayment,
};
