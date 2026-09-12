import config from "../../config";
import { sendTemplateMail } from "../../lib/mail";
import { buildInvoicePdf } from "../../lib/pdf";
import { mapWithLimit } from "../../utils/concurrency";
import { monthName, taka } from "../../utils/months";
import type { SettlementBill, SettlementResult } from "./cycle.settlement";

const MAIL_CONCURRENCY = 4;

export type BillRecipient = {
	memberId: string;
	name: string;
	email: string;
};

type CycleBillMailInput = {
	cycleId: string;
	messName: string;
	year: number;
	month: number;
	result: SettlementResult;
	recipients: BillRecipient[];
};

const SHARE_LABELS: Record<string, string> = {
	MAID: "Khala",
	GAS: "Gas",
	ELECTRICITY: "Electricity",
	WATER: "Water",
	INTERNET: "Internet",
	OTHER: "Other shared bills",
};

export const sharedLines = (bill: SettlementBill) =>
	bill.sharedBreakdown.map((share) => ({
		label: SHARE_LABELS[share.type] ?? share.type,
		amount: taka(share.amount),
	}));

const billData = (
	bill: SettlementBill,
	recipient: BillRecipient,
	input: CycleBillMailInput,
) => {
	const due = Number(bill.dueAmount);

	const opening = Number(bill.openingBalance);

	return {
		userName: recipient.name,
		messName: input.messName,
		monthName: monthName(input.month),
		year: input.year,
		openingBalance: taka(Math.abs(opening)),
		hasOpeningBalance: opening !== 0,
		openingWasOwed: opening > 0,
		advanceCharged: taka(bill.advanceCharged),
		hasAdvance: bill.advanceCharged > 0,
		totalMeals: input.result.totalMeals,
		totalGrocery: taka(input.result.totalGrocery),
		mealRate: taka(input.result.mealRate),
		mealCount: bill.mealCount,
		mealCost: taka(bill.mealCost),
		sharedCost: taka(bill.sharedCost),
		sharedLines: sharedLines(bill),
		rentShare: taka(bill.rentShare),
		totalPayable: taka(bill.totalPayable),
		depositTotal: taka(bill.depositTotal),
		paidExpenseTotal: taka(bill.paidExpenseTotal),
		hasDeposit: bill.depositTotal > 0,
		hasPaidExpense: bill.paidExpenseTotal > 0,
		creditAmount: taka(bill.creditAmount),
		dueAmount: taka(Math.max(due, 0)),
		refundAmount: taka(Math.abs(Math.min(due, 0))),
		owes: due > 0,
		isOwed: due < 0,
		loginUrl: `${config.frontend_url}/login`,
	};
};

export const sendCycleBills = async (input: CycleBillMailInput) => {
	const byMember = new Map(input.recipients.map((r) => [r.memberId, r]));

	const outcomes = await mapWithLimit(
		input.result.bills,
		MAIL_CONCURRENCY,
		async (bill) => {
			const recipient = byMember.get(bill.memberId);

			if (!recipient) {
				return;
			}

			const period = `${monthName(input.month)} ${input.year}`;
			const due = Number(bill.dueAmount);

			const pdf = await buildInvoicePdf({
				title: "Monthly Bill",
				invoiceNumber: `${input.cycleId.slice(0, 8)}-${bill.memberId.slice(0, 8)}`,
				issuedOn: new Date().toISOString().slice(0, 10),
				messName: input.messName,
				memberName: recipient.name,
				period,
				lines: [
					...(bill.openingBalance !== 0
						? [
								{
									label:
										bill.openingBalance > 0
											? "Brought forward from last month"
											: "In credit from last month",
									amount:
										bill.openingBalance > 0
											? taka(bill.openingBalance)
											: `- ${taka(Math.abs(bill.openingBalance))}`,
								},
							]
						: []),
					{
						label: `Meals eaten (${bill.mealCount} x ${taka(input.result.mealRate)})`,
						amount: taka(bill.mealCost),
					},
					...(bill.sharedBreakdown.length > 0
						? sharedLines(bill)
						: [
								{
									label: "Utilities and shared bills",
									amount: taka(bill.sharedCost),
								},
							]),
					{ label: "Rent share", amount: taka(bill.rentShare) },
					...(bill.advanceCharged > 0
						? [
								{
									label: "Next month's deposit",
									amount: taka(bill.advanceCharged),
								},
							]
						: []),
					{
						label: "Total payable",
						amount: taka(bill.totalPayable),
						strong: true,
					},
					...(bill.depositTotal > 0
						? [
								{
									label: "Less deposit",
									amount: `- ${taka(bill.depositTotal)}`,
								},
							]
						: []),
					...(bill.paidExpenseTotal > 0
						? [
								{
									label: "Less bazaar you paid yourself",
									amount: `- ${taka(bill.paidExpenseTotal)}`,
								},
							]
						: []),
				],
				totalLabel:
					due > 0 ? "You owe" : due < 0 ? "The mess owes you" : "Settled",
				totalAmount: taka(Math.abs(due)),
				note: `The mess spent BDT ${taka(input.result.totalGrocery)} on groceries over ${input.result.totalMeals} meals, making the meal rate BDT ${taka(input.result.mealRate)}.`,
			});

			await sendTemplateMail(
				recipient.email,
				`Your ${period} Bill - MessMate`,
				"monthly-bill",
				billData(bill, recipient, input),
				[
					{
						filename: `messmate-bill-${period.toLowerCase().replace(" ", "-")}.pdf`,
						content: pdf,
						contentType: "application/pdf",
					},
				],
			);
		},
	);

	const failed = outcomes.filter((o) => o.status === "rejected");

	console.log(
		`[cycle.mail] ${input.cycleId} bills: ${outcomes.length - failed.length} sent, ${failed.length} failed`,
	);

	for (const outcome of failed) {
		console.error("[cycle.mail][bills]", input.cycleId, outcome.reason);
	}
};

type WithdrawnBill = {
	name: string;
	email: string;
	previousDue: number;
};

type CycleReopenedMailInput = {
	cycleId: string;
	messName: string;
	year: number;
	month: number;
	withdrawn: WithdrawnBill[];
};

export const sendBillsWithdrawn = async (input: CycleReopenedMailInput) => {
	const outcomes = await mapWithLimit(
		input.withdrawn,
		MAIL_CONCURRENCY,
		(row) =>
			sendTemplateMail(
				row.email,
				`Your ${monthName(input.month)} ${input.year} Bill Is Being Recalculated - MessMate`,
				"bill-withdrawn",
				{
					userName: row.name,
					messName: input.messName,
					monthName: monthName(input.month),
					year: input.year,
					previousDue: taka(row.previousDue),
				},
			),
	);

	const failed = outcomes.filter((o) => o.status === "rejected");

	console.log(
		`[cycle.mail] ${input.cycleId} withdrawal notices: ${outcomes.length - failed.length} sent, ${failed.length} failed`,
	);

	for (const outcome of failed) {
		console.error("[cycle.mail][withdrawn]", input.cycleId, outcome.reason);
	}
};
