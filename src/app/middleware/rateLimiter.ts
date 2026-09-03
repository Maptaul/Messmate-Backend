import rateLimit from "express-rate-limit";
import httpStatus from "http-status";
import { RedisStore } from "rate-limit-redis";
import { ensureRedis } from "../lib/redis";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// The limiter answers with the same envelope as everything else, so a throttled
// client does not suddenly get a differently shaped body to parse.
const tooManyRequests = (message: string) => ({
	success: false,
	statusCode: httpStatus.TOO_MANY_REQUESTS,
	message,
	errors: [],
});

/**
 * The counters live in Redis rather than in process memory.
 *
 * The default store is a Map inside one process, which is correct only while
 * there is exactly one process. On serverless every instance would keep its own
 * tally, so "30 attempts per 15 minutes" would quietly become "30 per instance"
 * and a brute-force attempt would just be spread across cold starts. Shared
 * state belongs in the shared store.
 */
const redisStore = (prefix: string) =>
	new RedisStore({
		prefix,
		// `ensureRedis` rather than the bare client: this store sends its first
		// command while the module is still being imported, before any entry
		// point has had the chance to open the connection.
		sendCommand: async (...args: string[]) => {
			const client = await ensureRedis();

			return client.sendCommand(args) as never;
		},
	});

/**
 * Everything under /api/v1.
 *
 * Auth has its own tighter limiter and the bKash callback must never be
 * throttled, so both are skipped here. Without the skip they would be counted
 * twice, and the response would advertise the wrong budget.
 */
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

/**
 * Login and register are the brute-force targets, so they get a much smaller
 * budget. 300 attempts in a window would make rate limiting decorative.
 */
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
