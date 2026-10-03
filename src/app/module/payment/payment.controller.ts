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

const createStripeSession = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentServices.createStripeSession(req.body, req.user!);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Stripe Checkout Started Successfully",
		data: result,
	});
});

const confirmStripePayment = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentServices.confirmStripePayment(
		req.body,
		req.user!,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: result.paid
			? "Payment Confirmed Successfully"
			: "Payment Has Not Completed Yet",
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

// A file, not the JSON envelope: the browser saves it as the bill's PDF.
const downloadBillPdf = catchAsync(async (req: Request, res: Response) => {
	const billId = req.params.billId as string;
	const user = req.user!;

	const { pdf, fileName } = await PaymentServices.getBillPdf(billId, user);

	res.setHeader("Content-Type", "application/pdf");
	res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
	res.send(pdf);
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
	createStripeSession,
	confirmStripePayment,
	getCycleBills,
	recordCashPayment,
	paymentCallback,
	paymentResult,
	getMyPayments,
	getSinglePayment,
	downloadBillPdf,
};
