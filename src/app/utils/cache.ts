import { redisClient } from "../lib/redis";

/**
 * Read-through cache for the handful of reads that are expensive and shared.
 *
 * Redis is deliberately kept off the critical path. Every call here is wrapped,
 * and a Redis that is down, slow or evicting simply means the loader runs and
 * the caller still gets a correct answer. A cache that can 500 the endpoint it
 * was added to speed up is worse than no cache at all.
 *
 * Only cache what every caller sees identically. Permission checks stay outside
 * — they are decided per request, on the caller's own row.
 */
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
	} catch {
		// Unreachable cache is not an error, it is a miss.
	}

	const fresh = await load();

	try {
		await redisClient.set(key, JSON.stringify(fresh), {
			expiration: { type: "EX", value: ttlSeconds },
		});
	} catch {
		// Answering the caller matters more than remembering the answer.
	}

	return fresh;
};

/**
 * Dropped after a write, so the next read rebuilds. The TTL is only the backstop
 * for a delete that never landed.
 */
export const invalidateCache = async (key: string) => {
	try {
		await redisClient.del(key);
	} catch {
		// The TTL clears it soon enough.
	}
};

export const cacheKeys = {
	dashboardStats: "stats:dashboard",
	mealPlanCalendar: (cycleId: string) => `calendar:meal-plan:${cycleId}`,
	groceryDutyCalendar: (cycleId: string) => `calendar:grocery-duty:${cycleId}`,
};
