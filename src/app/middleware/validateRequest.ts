import type { NextFunction, Request, Response } from "express";
import type z from "zod";
import { catchAsync } from "../utils/catchAsync";

type TRequestSource = "body" | "params" | "query";

export const validateRequest = (
	zodSchema: z.ZodObject,
	source: TRequestSource = "body",
) => {
	return catchAsync((req: Request, _res: Response, next: NextFunction) => {
		const payload = req[source] ?? {};

		const result = zodSchema.safeParse(payload);

		if (!result.success) {
			throw result.error;
		}

		if (source === "query") {
			// req.query has no setter in Express 5, so it must be redefined
			// instead of reassigned.
			Object.defineProperty(req, "query", {
				value: result.data,
				writable: true,
				configurable: true,
			});
		} else {
			req[source] = result.data;
		}

		next();
	});
};
