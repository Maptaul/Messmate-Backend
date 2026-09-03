import bcrypt from "bcryptjs";
import type { TokenPayload } from "google-auth-library";
import httpStatus from "http-status";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import { AuthProvider, Role, UserStatus } from "../../../generated/prisma/enums";
import config from "../../config";
import { googleClient } from "../../lib/googleAuth";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { jwtUtils } from "../../utils/jwt";
import type {
	IGoogleLoginPayload,
	ILoginUserPayload,
	IRegisterUserPayload,
	IRequestUser,
} from "./auth.interface";

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

const registerUser = async (payload: IRegisterUserPayload) => {
	const { name, password, phone } = payload;

	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(httpStatus.CONFLICT, "User With This Email Already Exists");
	}

	const hashedPassword = await bcrypt.hash(
		password,
		Number(config.bcrypt_salt_rounds),
	);

	// The schema only allows MESS_MANAGER or MEMBER here. ADMIN is seeded, so no
	// request can ever create one.
	const role = payload.role === "MESS_MANAGER" ? Role.MESS_MANAGER : Role.MEMBER;

	const createdUser = await prisma.user.create({
		data: {
			name,
			email,
			password: hashedPassword,
			phone: phone ?? null,
			role,
			status: UserStatus.ACTIVE,
			authProvider: AuthProvider.CREDENTIAL,
		},
		omit: { password: true },
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
	// than letting bcrypt.compare fail against null and returning a misleading
	// "invalid credentials".
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
		throw new AppError(httpStatus.UNAUTHORIZED, "User Is Inactive Or Not Found");
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
		console.error("[auth.service][googleLogin] Id token verification failed", error);
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
		// Google register. New accounts are always MEMBER.
		user = await prisma.user.create({
			data: {
				name: googleIdTokenPayload.name,
				email,
				role: Role.MEMBER,
				googleId: googleIdTokenPayload.sub,
				authProvider: AuthProvider.GOOGLE,
				avatarUrl: googleIdTokenPayload.picture ?? null,
			},
		});
	}

	const { accessToken, refreshToken } = createAuthTokens(user);

	return {
		accessToken,
		refreshToken,
	};
};

export const AuthService = {
	registerUser,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
};
