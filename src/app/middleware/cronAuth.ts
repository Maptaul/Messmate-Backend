import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";

const matches = (candidate: string, expected: string) => {
	const left = Buffer.from(candidate);
	const right = Buffer.from(expected);

	return left.length === right.length && timingSafeEqual(left, right);
};

export const cronAuth = (req: Request, _res: Response, next: NextFunction) => {
	if (!config.cron_secret) {
		throw new AppError(
			httpStatus.SERVICE_UNAVAILABLE,
			"Scheduled Jobs Are Not Configured",
		);
	}

	const header = req.get("authorization") ?? "";

	if (!matches(header, `Bearer ${config.cron_secret}`)) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid Credentials For A Scheduled Job",
		);
	}

	next();
};
