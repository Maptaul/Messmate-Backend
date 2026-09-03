import { createClient } from "redis";
import config from "../config";

export const redisClient = createClient({
	username: config.redis_user,
	password: config.redis_password,
	socket: {
		host: config.redis_host,
		port: Number(config.redis_port),
	},
});

let connecting: Promise<unknown> | null = null;

/**
 * Opens the connection if it is not already open, and is safe to call from
 * anywhere, any number of times, concurrently.
 *
 * Import order is why this exists. `app.ts` pulls in the rate limiter, whose
 * Redis store issues a command the moment the module evaluates - which is
 * before any entry point gets a chance to call `connect()`, because imports are
 * always evaluated first. Anything that reaches for Redis has to be able to
 * open it itself rather than assume someone else already did.
 *
 * `connect()` throws if called on a client that is already open or opening, so
 * concurrent callers share one attempt; a failed attempt is cleared so the next
 * caller can retry.
 */
export const ensureRedis = async () => {
	if (redisClient.isOpen) {
		return redisClient;
	}

	if (!connecting) {
		connecting = redisClient.connect().finally(() => {
			connecting = null;
		});
	}

	await connecting;

	return redisClient;
};
