import type { NextFunction, Request, Response } from "express";
import type z from "zod";
import { catchAsync } from "../utils/catchAsync";

export const validateRequest = (zodSchema: z.ZodObject) => {
	return catchAsync((req: Request, _res: Response, next: NextFunction) => {
		const payload = req.body ?? {};

		const result = zodSchema.safeParse(payload);

		if (!result.success) {
			// Rethrow the ZodError itself rather than flattening it into an
			// AppError here. The global handler expands every issue into the
			// { field, message } entries the response contract requires; wrapping
			// it first would throw away all but the first message.
			throw result.error;
		}

		req.body = result.data;

		next();
	});
};
