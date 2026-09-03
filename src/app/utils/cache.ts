import { redisClient } from "../lib/redis";

export const cached = async <T>(
	key: string,
	ttlSeconds: number,
	load: () => Promise<T>,
): Promise<T> => {
	try {
		const hit = await redisClient.get(key);

		if (hit) {
			return JSON.parse(hit) as T;
		}
	} catch {}

	const fresh = await load();

	try {
		await redisClient.set(key, JSON.stringify(fresh), {
			expiration: { type: "EX", value: ttlSeconds },
		});
	} catch {}

	return fresh;
};

export const invalidateCache = async (key: string) => {
	try {
		await redisClient.del(key);
	} catch {}
};

export const cacheKeys = {
	dashboardStats: "stats:dashboard",
	mealPlanCalendar: (cycleId: string) => `calendar:meal-plan:${cycleId}`,
	groceryDutyCalendar: (cycleId: string) => `calendar:grocery-duty:${cycleId}`,
};
