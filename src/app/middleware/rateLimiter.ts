import rateLimit from "express-rate-limit";
import httpStatus from "http-status";

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
	message: tooManyRequests(
		"Too many authentication attempts. Please try again later.",
	),
});
