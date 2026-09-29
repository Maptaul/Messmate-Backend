import type { Request } from "express";

// Only endpoints that take a password or an OTP get the strict budget. /me,
// /refresh-token and /logout run on every page load of the frontend, which
// proxies everyone through one server, so they count toward the general limit.
const SESSION_ROUTE = /^\/api\/v1\/auth\/(me|refresh-token|logout)(\?|$)/;

export const isCredentialRoute = (req: Pick<Request, "originalUrl">) =>
	req.originalUrl.startsWith("/api/v1/auth") &&
	!SESSION_ROUTE.test(req.originalUrl);
