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
