import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";

import app from "../src/app";
import config from "../src/app/config";
import { seedSuperAdmin } from "../src/app/utils/seed";
import { prisma } from "../src/app/lib/prisma";
import { redisClient } from "../src/app/lib/redis";

let server: http.Server;
let baseUrl: string;

const api = (path: string, init?: RequestInit) =>
	fetch(`${baseUrl}${path}`, init);

before(async () => {
	server = http.createServer(app);

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

	baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));

	await prisma.$disconnect();

	if (redisClient.isOpen) {
		await redisClient.destroy();
	}
});

test("the root endpoint introduces the API", async () => {
	const res = await api("/");
	const body = await res.json();

	assert.equal(res.status, 200);
	assert.equal(body.success, true);
	assert.equal(body.data.version, "v1");
});

test("every response carries a request id", async () => {
	const res = await api("/");
	const id = res.headers.get("x-request-id");

	assert.match(id ?? "", /^[0-9a-f-]{36}$/);
});

test("two requests get two different ids", async () => {
	const [first, second] = await Promise.all([api("/"), api("/")]);

	assert.notEqual(
		first.headers.get("x-request-id"),
		second.headers.get("x-request-id"),
	);
});

test("an unknown route is a 404, not a crash", async () => {
	const res = await api("/api/v1/there-is-no-such-thing");

	assert.equal(res.status, 404);
});

test("a protected route refuses an anonymous caller", async () => {
	const res = await api("/api/v1/cycle/some-cycle-id");
	const body = await res.json();

	assert.equal(res.status, 401);
	assert.equal(body.success, false);
	assert.equal(body.requestId, res.headers.get("x-request-id"));
});

test("a scheduled job refuses a caller with no secret", async () => {
	const res = await api("/api/v1/cron/meal-plan-reminder");

	assert.equal(res.status, 401);
});

test("a scheduled job refuses a caller with the wrong secret", async () => {
	const res = await api("/api/v1/cron/unpaid-bill-reminder", {
		headers: { authorization: "Bearer definitely-not-the-secret" },
	});

	assert.equal(res.status, 401);
});

test("a mess audit trail is not readable anonymously", async () => {
	const res = await api("/api/v1/mess/audit-logs/some-mess-id");

	assert.equal(res.status, 401);
});

test("the whole cycle's bills are not readable anonymously", async () => {
	const res = await api("/api/v1/payment/cycle-bills/some-cycle-id");

	assert.equal(res.status, 401);
});

test("recording cash needs a logged-in manager", async () => {
	const res = await api("/api/v1/payment/record-cash-payment", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ billId: "some-bill", amount: 100 }),
	});

	assert.equal(res.status, 401);
});

test("the new mess routes refuse an anonymous caller", async () => {
	const calls: [string, string][] = [
		["GET", "/api/v1/cycle/settlement-preview/some-cycle-id"],
		["PATCH", "/api/v1/meal-plan/set-default-meals"],
		["GET", "/api/v1/mess/activity-unread/some-mess-id"],
		["PATCH", "/api/v1/mess/activity-seen/some-mess-id"],
		["GET", "/api/v1/cron/meal-headcount"],
		["GET", "/api/v1/finance/categories"],
		["POST", "/api/v1/finance/add-entry"],
		["GET", "/api/v1/finance/my-entries"],
		["GET", "/api/v1/finance/summary"],
		["PATCH", "/api/v1/finance/update-entry/some-entry-id"],
		["DELETE", "/api/v1/finance/delete-entry/some-entry-id"],
	];

	for (const [method, path] of calls) {
		const res = await api(path, { method });

		assert.equal(res.status, 401, `${method} ${path}`);
	}
});

test("the payment result page is public and returns html", async () => {
	const res = await api("/api/v1/payment/result?status=success");
	const body = await res.text();

	assert.equal(res.status, 200);
	assert.match(res.headers.get("content-type") ?? "", /text\/html/);
	assert.match(body, /Payment received/);
});

test("a list endpoint clamps the page size it is asked for", async () => {
	await seedSuperAdmin();

	const login = await api("/api/v1/auth/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email: config.super_admin_email,
			password: config.super_admin_password,
		}),
	});

	assert.equal(login.status, 200, "the seeded admin should be able to log in");

	const token = (await login.json()).data.accessToken;

	const meta = async (query: string) => {
		const res = await api(`/api/v1/mess/all-messes?${query}`, {
			headers: { authorization: `Bearer ${token}` },
		});

		assert.equal(res.status, 200, query);

		return (await res.json()).meta;
	};

	assert.equal((await meta("limit=99999")).limit, 100, "oversized clamps");
	assert.equal((await meta("limit=0")).limit, 10, "zero falls back");
	assert.equal((await meta("limit=abc")).limit, 10, "junk falls back");
	assert.equal((await meta("limit=7.9")).limit, 7, "fractional floors");
	assert.equal((await meta("limit=-5")).limit, 1, "negative never reaches take");

	const negativePage = await meta("page=-3&limit=5");

	assert.equal(negativePage.page, 1, "a negative page gives no negative skip");

	const normal = await meta("limit=25&page=2");

	assert.equal(normal.limit, 25, "a sensible limit passes through");
	assert.equal(normal.page, 2, "a sensible page passes through");
});

test("helmet is doing its job", async () => {
	const res = await api("/");

	assert.equal(res.headers.get("x-content-type-options"), "nosniff");
	assert.equal(res.headers.get("x-powered-by"), null);
});

test("a bad json body is a 400, not a 500", async () => {
	const res = await api("/api/v1/auth/login", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{not json",
	});

	assert.ok(res.status >= 400 && res.status < 500, `got ${res.status}`);
});
