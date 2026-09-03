import app from "../src/app";
import { ensureRedis } from "../src/app/lib/redis";

/**
 * Vercel serverless entry. `src/server.ts` is the local one - it opens the
 * connections, seeds the demo accounts and calls `app.listen()`. None of that
 * runs here, so anything the app needs open has to be opened here instead.
 *
 * Redis is the one that matters: the OTP flow and the bKash token cache both
 * live in it, and without this the first register or payment would fail with
 * "The client is closed". Once per cold start, then reused while the instance
 * stays warm.
 *
 * Prisma needs no equivalent - it connects lazily on its first query.
 */
try {
	await ensureRedis();
} catch (error) {
	// Not fatal: most routes never touch Redis, the ones that do report their
	// own failure, and `ensureRedis` retries on the next call anyway. Killing
	// the whole function would take down the endpoints that were fine.
	console.error("Redis connection failed on cold start:", error);
}

export default app;
