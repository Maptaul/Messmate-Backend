import assert from "node:assert/strict";
import { test } from "node:test";

import { dhakaDateOnly } from "../src/app/module/cron/cron.service";

const iso = (date: Date) => date.toISOString().slice(0, 10);

test("the reminder run at 22:00 Dhaka asks about the next day", () => {
	const runsAt = new Date("2026-09-10T16:00:00Z");

	assert.equal(iso(dhakaDateOnly(runsAt, 1)), "2026-09-11");
});

test("the headcount run at 23:05 Dhaka counts the next day", () => {
	const runsAt = new Date("2026-09-10T17:05:00Z");

	assert.equal(iso(dhakaDateOnly(runsAt, 1)), "2026-09-11");
});

test("late Dhaka evening is still the same Dhaka day, not the next UTC day", () => {
	const elevenPmDhaka = new Date("2026-09-10T17:30:00Z");

	assert.equal(iso(dhakaDateOnly(elevenPmDhaka)), "2026-09-10");
});

test("just after midnight Dhaka has already rolled over", () => {
	const justAfterMidnightDhaka = new Date("2026-09-10T18:30:00Z");

	assert.equal(iso(dhakaDateOnly(justAfterMidnightDhaka)), "2026-09-11");
});

test("rolls into the next month at a month boundary", () => {
	const augustLastEvening = new Date("2026-08-31T16:00:00Z");

	assert.equal(iso(dhakaDateOnly(augustLastEvening, 1)), "2026-09-01");
});

test("rolls into the next year at a year boundary", () => {
	const decemberLastEvening = new Date("2026-12-31T16:00:00Z");

	assert.equal(iso(dhakaDateOnly(decemberLastEvening, 1)), "2027-01-01");
});

test("returns midnight UTC so it matches a Prisma date column", () => {
	const date = dhakaDateOnly(new Date("2026-09-10T16:00:00Z"), 1);

	assert.equal(date.getUTCHours(), 0);
	assert.equal(date.getUTCMinutes(), 0);
	assert.equal(date.getUTCSeconds(), 0);
	assert.equal(date.getUTCMilliseconds(), 0);
});
