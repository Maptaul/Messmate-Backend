import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ExpenseServices } from "./expense.service";

const addExpense = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await ExpenseServices.addExpense(payload, req.file, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Expense Recorded Successfully",
		data: result,
	});
});

const getCycleExpenses = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const { data, meta } = await ExpenseServices.getCycleExpenses(
		cycleId,
		req.query,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Expenses Retrieved Successfully",
		data,
		meta,
	});
});

const getExpenseSummary = catchAsync(async (req: Request, res: Response) => {
	const cycleId = req.params.cycleId as string;
	const user = req.user!;

	const result = await ExpenseServices.getExpenseSummary(cycleId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Expense Summary Retrieved Successfully",
		data: result,
	});
});

const updateExpense = catchAsync(async (req: Request, res: Response) => {
	const expenseId = req.params.expenseId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await ExpenseServices.updateExpense(
		expenseId,
		payload,
		req.file,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Expense Updated Successfully",
		data: result,
	});
});

const deleteExpense = catchAsync(async (req: Request, res: Response) => {
	const expenseId = req.params.expenseId as string;
	const user = req.user!;

	const result = await ExpenseServices.deleteExpense(expenseId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Expense Deleted Successfully",
		data: result,
	});
});

export const ExpenseController = {
	addExpense,
	getCycleExpenses,
	getExpenseSummary,
	updateExpense,
	deleteExpense,
};
