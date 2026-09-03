import app from "../src/app";

/**
 * Vercel serverless entry — exports the Express app as the request handler.
 * (`src/server.ts` with `app.listen()` is only used locally and on container
 * hosts.)
 *
 * Nothing is opened here on purpose. An earlier version awaited Redis at module
 * scope, which is both a top-level-await risk in whatever module format the
 * bundler emits and unnecessary: `ensureRedis()` is idempotent and the rate
 * limiter calls it on the first request that reaches `/api/v1`, so the
 * connection opens itself exactly once per cold start either way.
 */
export default app;
