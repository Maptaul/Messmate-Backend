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

// node-redis throws an unlistened "error" event and the process exits; with a
// listener a dropped connection is logged and the client reconnects itself.
redisClient.on("error", (error) => {
	console.error("[redis]", error);
});

let connecting: Promise<unknown> | null = null;

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

export const redis = {
	get: async (...args: Parameters<typeof redisClient.get>) =>
		(await ensureRedis()).get(...args),

	set: async (...args: Parameters<typeof redisClient.set>) =>
		(await ensureRedis()).set(...args),

	del: async (...args: Parameters<typeof redisClient.del>) =>
		(await ensureRedis()).del(...args),

	ttl: async (...args: Parameters<typeof redisClient.ttl>) =>
		(await ensureRedis()).ttl(...args),
};
