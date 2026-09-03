import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { ZodError } from "zod";
import { Prisma } from "../../generated/prisma/client";
import config from "../config";
import { AppError } from "../utils/AppError";

type TErrorSource = {
	field: string;
	message: string;
};

export const globalErrorHandler = async (
	err: any,
	_req: Request,
	res: Response,
	_next: NextFunction,
) => {
	const isDevelopment = config.node_env === "development";

	if (isDevelopment) {
		console.log("Error from Global Error Handler", err);
	}

	let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR;
	let errorMessage = err.message || "Internal Server Error";
	const errorName = err.name || "Internal Server Error";

	// The assignment mandates an `errors` array on every failure response.
	// It stays empty when there is nothing field-specific to report.
	let errors: TErrorSource[] = [];

	// Whether the real message is safe to send. True for errors we raised on
	// purpose; false only for a genuinely unknown crash, which must not leak.
	let isKnownError = false;

	if (err instanceof ZodError) {
		// validateRequest converts most Zod failures into an AppError first, so
		// this branch catches schemas parsed directly inside a service.
		statusCode = httpStatus.BAD_REQUEST;
		isKnownError = true;
		errors = err.issues.map((issue) => ({
			field: issue.path.join("."),
			message: issue.message,
		}));
		// Lead with the first problem so the message alone is actionable, and keep
		// the full list in errors.
		errorMessage = errors[0]?.message ?? "Validation failed";
	} else if (err instanceof AppError) {
		statusCode = err.statusCode;
		errorMessage = err.message;
		isKnownError = true;
	} else if (err instanceof Prisma.PrismaClientValidationError) {
		statusCode = httpStatus.BAD_REQUEST;
		errorMessage = "You have provided incorrect field type or missing fields";
		isKnownError = true;
	} else if (err instanceof Prisma.PrismaClientKnownRequestError) {
		isKnownError = true;

		if (err.code === "P2002") {
			// A unique constraint is a business rule here (one bill per member per
			// cycle, one meal entry per member per day), so 409 rather than 400.
			statusCode = httpStatus.CONFLICT;
			const target = err.meta?.target as string[] | undefined;
			errorMessage = "This record already exists";
			errors = (target ?? []).map((field) => ({
				field,
				message: "Must be unique",
			}));
		} else if (err.code === "P2003") {
			statusCode = httpStatus.BAD_REQUEST;
			errorMessage = "Foreign key constraint failed";
		} else if (err.code === "P2025") {
			statusCode = httpStatus.NOT_FOUND;
			errorMessage = "The requested record was not found";
		} else {
			statusCode = httpStatus.BAD_REQUEST;
			errorMessage = "Database request failed";
		}
	} else if (err instanceof Prisma.PrismaClientInitializationError) {
		isKnownError = true;

		if (err.errorCode === "P1000") {
			statusCode = httpStatus.UNAUTHORIZED;
			errorMessage =
				"Authentication failed against database server. Please check your credentials";
		} else if (err.errorCode === "P1001") {
			statusCode = httpStatus.BAD_REQUEST;
			errorMessage = "Cannot reach database server";
		} else {
			statusCode = httpStatus.INTERNAL_SERVER_ERROR;
			errorMessage = "Database initialization failed";
		}
	} else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
		statusCode = httpStatus.INTERNAL_SERVER_ERROR;
		errorMessage = "Error occurred during query execution";
	}

	// An unknown error keeps its detail in the server log only.
	if (!isKnownError) {
		console.error("[globalErrorHandler] Unhandled error", err);
	}

	res.status(statusCode).json({
		success: false,
		statusCode,
		message:
			isKnownError || isDevelopment ? errorMessage : "Internal Server Error",
		errors,
		name: isDevelopment ? errorName : undefined,
		error: isDevelopment ? err : undefined,
		stack: isDevelopment ? err.stack : undefined,
	});
};
