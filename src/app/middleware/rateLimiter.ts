import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import { RedisStore } from "rate-limit-redis";
import { ensureRedis } from "../lib/redis";
import {
	credentialLimitKey,
	generalLimitKey,
	isCredentialRoute,
	skipsGeneralLimit,
} from "../utils/credentialRoute";

const WINDOW_MS = 15 * 60 * 1000;

// One dashboard page costs the frontend 12–17 API calls, so 300 ran out after
// about 20 pages. 1000 is roughly a page every 13 seconds for 15 minutes.
const GENERAL_LIMIT = 1000;

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
	limit: GENERAL_LIMIT,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	store: redisStore("rl:general:"),
	keyGenerator: generalLimitKey,
	passOnStoreError: true,
	skip: skipsGeneralLimit,
	message: tooManyRequests("Too many requests. Please try again later."),
});

export const authLimiter = rateLimit({
	windowMs: WINDOW_MS,
	limit: 30,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	store: redisStore("rl:auth:"),
	keyGenerator: credentialLimitKey,
	passOnStoreError: true,
	skip: (req) => !isCredentialRoute(req),
	message: tooManyRequests(
		"Too many authentication attempts. Please try again later.",
	),
});
