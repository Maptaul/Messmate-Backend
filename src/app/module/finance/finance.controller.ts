import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { FinanceServices } from "./finance.service";

const getCategories = catchAsync(async (_req: Request, res: Response) => {
	const result = FinanceServices.getCategories();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Finance Categories Retrieved Successfully",
		data: result,
	});
});

const addEntry = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await FinanceServices.addEntry(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Entry Added Successfully",
		data: result,
	});
});

const getMyEntries = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await FinanceServices.getMyEntries(req.query, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Entries Retrieved Successfully",
		data,
		meta,
	});
});

const getSummary = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await FinanceServices.getSummary(req.query, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Summary Retrieved Successfully",
		data: result,
	});
});

const updateEntry = catchAsync(async (req: Request, res: Response) => {
	const entryId = req.params.entryId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await FinanceServices.updateEntry(entryId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Entry Updated Successfully",
		data: result,
	});
});

const deleteEntry = catchAsync(async (req: Request, res: Response) => {
	const entryId = req.params.entryId as string;
	const user = req.user!;

	const result = await FinanceServices.deleteEntry(entryId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Entry Deleted Successfully",
		data: result,
	});
});

export const FinanceController = {
	getCategories,
	addEntry,
	getMyEntries,
	getSummary,
	updateEntry,
	deleteEntry,
};
