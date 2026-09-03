import bcrypt from "bcryptjs";
import crypto from "crypto";
import ejs from "ejs";
import type { TokenPayload } from "google-auth-library";
import httpStatus from "http-status";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import path from "path";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import { AppError } from "../../utils/AppError";
import { jwtUtils } from "../../utils/jwt";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterUserPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";

const OTP_EXPIRATION_SECONDS = 5 * 60;
const OTP_EXPIRATION_TEXT = "5 minutes";

// Every token in this app carries the same claim set, so the shape lives in one
// place. Note the id claim is `userId`, which is what checkAuth reads back.
const createAuthTokens = (user: {
	id: string;
	name: string;
	email: string;
	role: Role;
}) => {
	const jwtPayload = {
		userId: user.id,
		name: user.name,
		email: user.email,
		role: user.role,
	};

	const accessToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_access_secret,
		config.jwt_access_expires_in as SignOptions,
	);

	const refreshToken = jwtUtils.createToken(
		jwtPayload,
		config.jwt_refresh_secret,
		config.jwt_refresh_expires_in as SignOptions,
	);

	return { accessToken, refreshToken };
};

// Renders an ejs template and mails it. Used four times in this module, so it
// stays here rather than being repeated per function.
const sendTemplateMail = async (
	to: string,
	subject: string,
	template: string,
	data: Record<string, unknown>,
) => {
	const templatePath = path.join(
		process.cwd(),
		`src/app/templates/${template}.ejs`,
	);

	const html = await ejs.renderFile(templatePath, data);

	await transporter.sendMail({
		from: config.email_sender,
		to,
		subject,
		html,
	});
};

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const registerUser = async (payload: IRegisterUserPayload) => {
	const { name, password, phone } = payload;

	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User With This Email Already Exists",
		);
	}

	const hashedPassword = await bcrypt.hash(
		password,
		Number(config.bcrypt_salt_rounds),
	);

	const otpKey = `user-registration-otp:${email}`;
	const otpValue = generateOtp();

	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX",
			value: OTP_EXPIRATION_SECONDS,
		},
	});

	// The user row is not created yet. Everything needed to create it waits in
	// Redis and expires with the OTP, so an abandoned signup leaves nothing
	// behind and does not hold the email address hostage.
	const registrationKey = `user-registration-data:${email}`;

	await redisClient.set(
		registrationKey,
		JSON.stringify({
			name,
			email,
			password: hashedPassword,
			phone: phone ?? null,
			role: payload.role,
		}),
		{
			expiration: {
				type: "EX",
				value: OTP_EXPIRATION_SECONDS,
			},
		},
	);

	await sendTemplateMail(
		email,
		"Verify Your MessMate Email",
		"registration-user-otp",
		{
			email,
			otp: otpValue,
			expirationTime: OTP_EXPIRATION_TEXT,
		},
	);
};

const verifyUserEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const isUserExist = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExist) {
		throw new AppError(httpStatus.CONFLICT, "Email Already Verified");
	}

	const otpKey = `user-registration-otp:${email}`;

	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"OTP Expired Or Not Found. Please Register Again.",
		);
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match");
	}

	const registrationKey = `user-registration-data:${email}`;

	const redisUserData = await redisClient.get(registrationKey);

	if (!redisUserData) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Registration Data Expired. Please Register Again.",
		);
	}

	const registrationPayload: IRegisterUserPayload & { phone: string | null } =
		JSON.parse(redisUserData);

	const role =
		registrationPayload.role === "MESS_MANAGER"
			? Role.MESS_MANAGER
			: Role.MEMBER;

	const createdUser = await prisma.user.create({
		data: {
			name: registrationPayload.name,
			email: registrationPayload.email,
			password: registrationPayload.password,
			phone: registrationPayload.phone,
			role,
			status: UserStatus.ACTIVE,
			authProvider: AuthProvider.CREDENTIAL,
			emailVerified: true,
		},
		omit: { password: true },
	});

	await redisClient.del([otpKey, registrationKey]);

	await sendTemplateMail(email, "Welcome To MessMate", "member-welcome-email", {
		userName: createdUser.name,
		loginUrl: `${config.frontend_url}/login`,
	});

	const { accessToken, refreshToken } = createAuthTokens(createdUser);

	return {
		user: createdUser,
		accessToken,
		refreshToken,
	};
};

const loginUser = async (payload: ILoginUserPayload) => {
	const { password } = payload;
	const email = payload.email.trim().toLowerCase();

	const user = await prisma.user.findUnique({
		where: { email },
	});

	if (!user) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	if (user.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
	}

	if (user.isDeleted) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
	}

	// A Google-only account has no password to compare against. Say so, rather
	// than letting bcrypt.compare fail against null and return a misleading
	// invalid-credentials message.
	if (user.password === null && user.googleId !== null) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"User Already Has Account Registered With Google. Try To Login With Google.",
		);
	}

	const isPasswordMatched = await bcrypt.compare(
		password,
		user.password as string,
	);

	if (!isPasswordMatched) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Invalid Credentials");
	}

	const { accessToken, refreshToken } = createAuthTokens(user);

	return {
		accessToken,
		refreshToken,
	};
};

const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		omit: {
			password: true,
		},
		include: {
			memberships: {
				where: { isDeleted: false },
				select: {
					id: true,
					status: true,
					joinedAt: true,
					leftAt: true,
					mess: { select: { id: true, name: true, address: true } },
				},
			},
			managedMesses: {
				where: { isDeleted: false },
				select: { id: true, name: true, address: true, monthlyRent: true },
			},
		},
	});

	if (!isUserExists) {
		throw new AppError(httpStatus.NOT_FOUND, "User Not Found");
	}

	return isUserExists;
};

const refreshToken = async (token: string) => {
	const verifiedRefreshToken = jwtUtils.verifyToken(
		token,
		config.jwt_refresh_secret,
	);

	if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			config.node_env === "development"
				? verifiedRefreshToken.error
				: "Invalid Refresh Token",
		);
	}

	const data = verifiedRefreshToken.data as JwtPayload;

	const user = await prisma.user.findUnique({
		where: { id: data.userId },
	});

	if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"User Is Inactive Or Not Found",
		);
	}

	// Rebuilt from the database row, not from the old token, so a role change or
	// a rename takes effect on the next refresh.
	const { accessToken, refreshToken: newRefreshToken } = createAuthTokens(user);

	return {
		accessToken,
		refreshToken: newRefreshToken,
	};
};

const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	try {
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.error(
			"[auth.service][googleLogin] Id token verification failed",
			error,
		);
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid Or Expired Google Id Token",
		);
	}

	if (!googleIdTokenPayload) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid Or Expired Google Id Token",
		);
	}

	if (!googleIdTokenPayload.email) {
		throw new AppError(httpStatus.BAD_REQUEST, "Google Email Not Found");
	}

	if (!googleIdTokenPayload.name) {
		throw new AppError(httpStatus.BAD_REQUEST, "Google Account Name Not Found");
	}

	const email = googleIdTokenPayload.email.trim().toLowerCase();

	let user = await prisma.user.findUnique({
		where: { email },
	});

	if (user) {
		if (user.status === UserStatus.BLOCKED) {
			throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
		}

		if (user.isDeleted) {
			throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
		}

		// An existing credential account signing in with Google for the first
		// time gets linked. The role is never touched here - a social login must
		// not be able to change what someone is allowed to do.
		if (!user.googleId) {
			user = await prisma.user.update({
				where: { id: user.id },
				data: { googleId: googleIdTokenPayload.sub },
			});
		}
	} else {
		// Google register. New accounts are always MEMBER. Google has already
		// proven the address, so no OTP round trip is needed here.
		user = await prisma.user.create({
			data: {
				name: googleIdTokenPayload.name,
				email,
				role: Role.MEMBER,
				googleId: googleIdTokenPayload.sub,
				authProvider: AuthProvider.GOOGLE,
				emailVerified: true,
				avatarUrl: googleIdTokenPayload.picture ?? null,
			},
		});

		await sendTemplateMail(
			email,
			"Welcome To MessMate",
			"member-welcome-email",
			{
				userName: user.name,
				loginUrl: `${config.frontend_url}/login`,
			},
		);
	}

	const { accessToken, refreshToken } = createAuthTokens(user);

	return {
		accessToken,
		refreshToken,
	};
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
	const email = payload.email.trim().toLowerCase();

	const isUserExist = await prisma.user.findUnique({
		where: { email },
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!");
	}

	if (isUserExist.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
	}

	if (isUserExist.isDeleted) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
	}

	if (
		isUserExist.googleId &&
		isUserExist.authProvider === AuthProvider.GOOGLE
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This Account Uses Google Sign In. There Is No Password To Reset.",
		);
	}

	const otp = generateOtp();

	const otpKey = `forgot-password-otp:${email}`;

	await redisClient.set(otpKey, otp, {
		expiration: {
			type: "EX",
			value: OTP_EXPIRATION_SECONDS,
		},
	});

	await sendTemplateMail(
		email,
		"Reset Your MessMate Password",
		"forgot-password",
		{
			otp,
			expirationTime: OTP_EXPIRATION_TEXT,
		},
	);
};

const resetPassword = async (payload: IResetPasswordPayload) => {
	const { otp, newPassword } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExist = await prisma.user.findUnique({
		where: { email },
	});

	if (!isUserExist) {
		throw new AppError(httpStatus.NOT_FOUND, "User Does Not Exist!");
	}

	if (isUserExist.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
	}

	if (isUserExist.isDeleted) {
		throw new AppError(httpStatus.FORBIDDEN, "User Is Deleted");
	}

	if (
		isUserExist.googleId &&
		isUserExist.authProvider === AuthProvider.GOOGLE
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"This Account Uses Google Sign In. There Is No Password To Reset.",
		);
	}

	const otpKey = `forgot-password-otp:${email}`;

	const redisOtp = await redisClient.get(otpKey);

	if (!redisOtp) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"OTP Expired Or Not Found. Please Request A New One.",
		);
	}

	if (redisOtp !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP Does Not Match");
	}

	const hashedNewPassword = await bcrypt.hash(
		newPassword,
		Number(config.bcrypt_salt_rounds),
	);

	await prisma.user.update({
		where: { email },
		data: { password: hashedNewPassword },
	});

	// Burn the OTP so the same code cannot change the password twice.
	await redisClient.del([otpKey]);

	await sendTemplateMail(
		email,
		"Your MessMate Password Was Changed",
		"reset-password-success",
		{
			userName: isUserExist.name,
			loginUrl: `${config.frontend_url}/login`,
		},
	);
};

export const AuthService = {
	registerUser,
	verifyUserEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
};
