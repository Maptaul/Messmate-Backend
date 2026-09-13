import httpStatus from "http-status";
import config from "../config";
import type { IBkashExecuteResult } from "../module/payment/payment.interface";
import { AppError } from "../utils/AppError";
import { redis } from "./redis";

// bKash's guidance: when execute answers with something unreadable, ask
// payment/status before deciding. The sandbox has sent execute bodies that are
// not valid JSON. null means neither call gave a usable answer, so the caller
// must leave the payment untouched: money may still have moved.
export const executeBkashPayment = async (
	idToken: string,
	paymentID: string,
): Promise<IBkashExecuteResult | null> => {
	for (const path of ["execute", "payment/status"]) {
		try {
			const response = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/${path}`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						authorization: idToken,
						"x-app-key": config.bkash_app_key,
					},
					body: JSON.stringify({ paymentID }),
				},
			);

			return (await response.json()) as IBkashExecuteResult;
		} catch (error) {
			console.error(`[bkash][${path}]`, paymentID, error);
		}
	}

	return null;
};

export const getBkashIdToken = async () => {
	try {
		const IdTokenKey = "bkash:idToken";
		const RefreshTokenKey = "bkash:refreshToken";

		let bkashIdToken = await redis.get(IdTokenKey);
		const bkashIdTokenTTL = await redis.ttl(IdTokenKey);

		const bkashRefreshToken = await redis.get(RefreshTokenKey);
		const bkashRefreshTokenTTL = await redis.ttl(RefreshTokenKey);

		if (
			(bkashIdTokenTTL <= 600 || !bkashIdToken) &&
			bkashRefreshToken &&
			bkashRefreshTokenTTL > 600
		) {
			const refreshTokenResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						username: config.bkash_username,
						password: config.bkash_password,
					},
					body: JSON.stringify({
						app_key: config.bkash_app_key,
						app_secret: config.bkash_app_secret,
						refresh_token: bkashRefreshToken,
					}),
				},
			);
			if (!refreshTokenResponse.ok) {
				throw new AppError(
					httpStatus.BAD_GATEWAY,
					"Bkash Access Token Grant Failed",
				);
			}

			const bkashRefreshTokenResult = await refreshTokenResponse.json();

			bkashIdToken = bkashRefreshTokenResult.id_token as string;

			await redis.set(IdTokenKey, bkashIdToken, {
				expiration: {
					type: "EX",
					value: 60 * 60,
				},
			});

			return bkashIdToken;
		}

		if (bkashIdTokenTTL > 600) {
			return bkashIdToken;
		}

		const response = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/token/grant`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					username: config.bkash_username,
					password: config.bkash_password,
				},
				body: JSON.stringify({
					app_key: config.bkash_app_key,
					app_secret: config.bkash_app_secret,
				}),
			},
		);

		if (!response.ok) {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"Bkash Access Token Grant Failed",
			);
		}

		const result = await response.json();

		await redis.set(IdTokenKey, result.id_token, {
			expiration: {
				type: "EX",
				value: 60 * 60,
			},
		});

		await redis.set(RefreshTokenKey, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 60 * 60 * 24 * 28,
			},
		});

		bkashIdToken = result.id_token;

		return bkashIdToken;
	} catch (error: any) {
		if (error instanceof AppError) {
			throw error;
		}
		throw new AppError(httpStatus.BAD_GATEWAY, error.message);
	}
};
