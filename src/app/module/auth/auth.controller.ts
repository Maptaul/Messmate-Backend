import type { CookieOptions, Request, Response } from "express";
import httpStatus from "http-status";
import config from "../../config";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { IRequestUser } from "./auth.interface";
import { AuthService } from "./auth.service";

const isProduction = config.node_env === "production";

// sameSite "none" is only honoured on a secure cookie, so the pair moves
// together: cross-site over https in production, lax over http locally.
const baseCookieOptions: CookieOptions = {
	httpOnly: true,
	secure: isProduction,
	sameSite: isProduction ? "none" : "lax",
};

const accessCookieOptions: CookieOptions = {
	...baseCookieOptions,
	maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
};

const refreshCookieOptions: CookieOptions = {
	...baseCookieOptions,
	maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
};

const registerUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.registerUser(payload);

	// No tokens yet - the account does not exist until the OTP is confirmed.
	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Verification OTP Sent To Your Email",
		data: null,
	});
});

const verifyUserEmail = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.verifyUserEmail(payload);

	const { accessToken, refreshToken, user } = result;

	res.cookie("accessToken", accessToken, accessCookieOptions);
	res.cookie("refreshToken", refreshToken, refreshCookieOptions);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Email Verified Successfully",
		data: {
			accessToken,
			refreshToken,
			user,
		},
	});
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.loginUser(payload);

	const { accessToken, refreshToken } = result;

	res.cookie("accessToken", accessToken, accessCookieOptions);
	res.cookie("refreshToken", refreshToken, refreshCookieOptions);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Logged In Successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user as unknown as IRequestUser;

	if (!user) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User Information Is Missing In The Request",
		);
	}

	const result = await AuthService.getMe(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Profile Fetched Successfully",
		data: result,
	});
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
	// Postman keeps the cookie jar, but the body is the escape hatch for a
	// client that cannot send cookies cross-site.
	const token = req.cookies?.refreshToken ?? req.body?.refreshToken;

	if (!token) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Refresh Token Is Missing");
	}

	const result = await AuthService.refreshToken(token);

	const { accessToken, refreshToken: newRefreshToken } = result;

	res.cookie("accessToken", accessToken, accessCookieOptions);
	res.cookie("refreshToken", newRefreshToken, refreshCookieOptions);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New Tokens Generated Successfully",
		data: {
			accessToken,
			refreshToken: newRefreshToken,
		},
	});
});

const googleLogin = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.googleLogin(payload);

	const { accessToken, refreshToken } = result;

	res.cookie("accessToken", accessToken, accessCookieOptions);
	res.cookie("refreshToken", refreshToken, refreshCookieOptions);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Logged In With Google Successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.forgotPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `OTP Sent To Email : ${payload.email}`,
		data: null,
	});
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.resetPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password Changed Successfully",
		data: null,
	});
});

const logoutUser = catchAsync(async (_req: Request, res: Response) => {
	// clearCookie only matches when the options match the ones used to set it.
	res.clearCookie("accessToken", baseCookieOptions);
	res.clearCookie("refreshToken", baseCookieOptions);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User Logged Out Successfully",
		data: null,
	});
});

export const AuthController = {
	registerUser,
	verifyUserEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
	logoutUser,
};
