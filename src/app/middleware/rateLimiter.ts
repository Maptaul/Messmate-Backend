import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import { RedisStore } from "rate-limit-redis";
import { ensureRedis } from "../lib/redis";

const WINDOW_MS = 15 * 60 * 1000;

const tooManyRequests = (message: string) => ({
	success: false,
	statusCode: httpStatus.TOO_MANY_REQUESTS,
	message,
	errors: [],
});

const redisStore = (prefix: string) =>
	new RedisStore({
		prefix,

		sendCommand: async (...args: string[]) => {
			const client = await ensureRedis();

			return client.sendCommand(args) as never;
		},
	});

export const generalLimiter = rateLimit({
	windowMs: WINDOW_MS,
	limit: 300,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	store: redisStore("rl:general:"),
	skip: (req) =>
		req.originalUrl.startsWith("/api/v1/auth") ||
		req.originalUrl.startsWith("/api/v1/payment/callback"),
	message: tooManyRequests("Too many requests. Please try again later."),
});

export const authLimiter = rateLimit({
	windowMs: WINDOW_MS,
	limit: 30,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	store: redisStore("rl:auth:"),
	message: tooManyRequests(
		"Too many authentication attempts. Please try again later.",
	),
});
