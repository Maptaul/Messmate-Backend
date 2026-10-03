import type { Request } from "express";
import { ipKeyGenerator } from "express-rate-limit";
import jwt, { type JwtPayload } from "jsonwebtoken";
import config from "../config";

// Only endpoints that take a password or an OTP get the strict budget. /me,
// /refresh-token and /logout run on every page load of the frontend, which
// proxies everyone through one server, so they count toward the general limit.
const SESSION_ROUTE = /^\/api\/v1\/auth\/(me|refresh-token|logout)(\?|$)/;

export const isCredentialRoute = (req: Pick<Request, "originalUrl">) =>
	req.originalUrl.startsWith("/api/v1/auth") &&
	!SESSION_ROUTE.test(req.originalUrl);

// Logout only clears the cookies, so a user who ran out of requests can still
// sign out; the bKash callback comes from the gateway, not a user.
const UNLIMITED_ROUTE = /^\/api\/v1\/(auth\/logout|payment\/callback)(\/|\?|$)/;

export const skipsGeneralLimit = (req: Pick<Request, "originalUrl">) =>
	isCredentialRoute(req) || UNLIMITED_ROUTE.test(req.originalUrl);

type TLimitRequest = Pick<Request, "ip" | "cookies" | "body">;

const ipKey = (req: TLimitRequest) => ipKeyGenerator(req.ip ?? "");

// Every frontend request reaches the API through Vercel, so the IP is shared
// by everyone. A signed-in request counts against its own user instead.
export const generalLimitKey = (req: TLimitRequest) => {
	try {
		const token = req.cookies?.accessToken;

		if (token) {
			const { userId } = jwt.verify(
				token,
				config.jwt_access_secret,
			) as JwtPayload;

			return `user:${userId}`;
		}
	} catch {
		// An expired or forged token is counted by IP.
	}

	return ipKey(req);
};

// Credential attempts are counted per account, so one person's wrong passwords
// don't lock out everyone else behind the same IP.
export const credentialLimitKey = (req: TLimitRequest) => {
	const email =
		typeof req.body?.email === "string"
			? req.body.email.trim().toLowerCase()
			: "";

	return `${ipKey(req)}:${email}`;
};
