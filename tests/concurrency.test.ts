import assert from "node:assert/strict";
import { test } from "node:test";

import { mapWithLimit } from "../src/app/utils/concurrency";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

test("every item is processed, in order, exactly once", async () => {
	const seen: number[] = [];

	const results = await mapWithLimit([1, 2, 3, 4, 5], 2, async (n) => {
		await tick();
		seen.push(n);
		return n * 10;
	});

	assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5]);
	assert.deepEqual(
		results.map((r) => (r.status === "fulfilled" ? r.value : null)),
		[10, 20, 30, 40, 50],
	);
});

test("never runs more than the limit at once", async () => {
	let running = 0;
	let peak = 0;

	await mapWithLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
		running += 1;
		peak = Math.max(peak, running);
		await tick();
		running -= 1;
	});

	assert.equal(peak, 4);
});

test("one failure does not stop the rest", async () => {
	const results = await mapWithLimit([1, 2, 3], 2, async (n) => {
		if (n === 2) {
			throw new Error("nope");
		}

		return n;
	});

	assert.equal(results[0]?.status, "fulfilled");
	assert.equal(results[1]?.status, "rejected");
	assert.equal(results[2]?.status, "fulfilled");
});

test("an empty list does nothing and returns nothing", async () => {
	const results = await mapWithLimit([], 4, async () => "never");

	assert.deepEqual(results, []);
});

test("a limit larger than the list is harmless", async () => {
	const results = await mapWithLimit([1, 2], 50, async (n) => n);

	assert.equal(results.length, 2);
	assert.equal(results[1]?.status, "fulfilled");
});
