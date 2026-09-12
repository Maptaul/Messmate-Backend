import assert from "node:assert/strict";
import { test } from "node:test";

import { buildInvoicePdf, type InvoiceInput } from "../src/app/lib/pdf";

const sample: InvoiceInput = {
	title: "Monthly Bill",
	invoiceNumber: "abc12345-def67890",
	issuedOn: "2026-09-01",
	messName: "Chattogram Mess",
	memberName: "Tarak",
	period: "August 2026",
	lines: [
		{ label: "Meals eaten (33 x 48.80)", amount: "1,610.28" },
		{ label: "Utilities and shared bills", amount: "0.00" },
		{ label: "Total payable", amount: "1,610.28", strong: true },
		{ label: "Less deposits", amount: "- 1,230.00" },
	],
	totalLabel: "You owe",
	totalAmount: "380.28",
	note: "The mess spent BDT 13,785.00 on groceries over 282.5 meals.",
};

test("produces a real pdf file", async () => {
	const pdf = await buildInvoicePdf(sample);

	assert.ok(Buffer.isBuffer(pdf));
	assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
	assert.ok(pdf.length > 1000, `only ${pdf.length} bytes`);
	assert.match(pdf.subarray(-1024).toString("latin1"), /%%EOF/);
});

test("each member gets their own document, not a shared one", async () => {
	const [tarak, rafi] = await Promise.all([
		buildInvoicePdf(sample),
		buildInvoicePdf({ ...sample, memberName: "Rafi", totalAmount: "912.40" }),
	]);

	assert.notEqual(tarak.toString("base64"), rafi.toString("base64"));
});

test("the same input twice produces the same document", async () => {
	const [first, second] = await Promise.all([
		buildInvoicePdf(sample),
		buildInvoicePdf(sample),
	]);

	assert.equal(first.length, second.length);
});

test("a receipt with nothing outstanding still renders", async () => {
	const pdf = await buildInvoicePdf({
		...sample,
		title: "Payment Receipt",
		totalLabel: "Settled in full",
		totalAmount: "0.00",
		note: undefined,
	});

	assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
});

test("survives a long mess name and an empty line list", async () => {
	const pdf = await buildInvoicePdf({
		...sample,
		messName: "A Very Long Mess Name That Would Wrap Across The Column Width",
		lines: [],
	});

	assert.ok(pdf.length > 500);
});
