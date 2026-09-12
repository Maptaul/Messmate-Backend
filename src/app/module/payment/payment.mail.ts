import { sendTemplateMail } from "../../lib/mail";
import { buildInvoicePdf } from "../../lib/pdf";
import { prisma } from "../../lib/prisma";
import { monthName, taka } from "../../utils/months";

export const sendPaymentReceipt = async (paymentId: string) => {
	try {
		const payment = await prisma.payment.findUnique({
			where: { id: paymentId },
			select: {
				amount: true,
				paidAt: true,
				bkashTrxId: true,
				paymentGateway: true,
				merchantInvoiceNumber: true,
				bill: {
					select: {
						totalPayable: true,
						creditAmount: true,
						paidAmount: true,
						dueAmount: true,
						cycle: { select: { year: true, month: true } },
					},
				},
				member: {
					select: {
						mess: { select: { name: true } },
						user: { select: { name: true, email: true } },
					},
				},
			},
		});

		if (!payment) {
			return;
		}

		const dueAmount = Number(payment.bill.dueAmount);
		const netPayable =
			Number(payment.bill.totalPayable) - Number(payment.bill.creditAmount);

		const period = `${monthName(payment.bill.cycle.month)} ${payment.bill.cycle.year}`;
		const paidOn = (payment.paidAt ?? new Date()).toISOString().slice(0, 10);

		const isCash = payment.paymentGateway === "cash";

		const methodLabel = isCash
			? "Cash, handed to the manager"
			: `bKash ${payment.bkashTrxId ?? "-"}`;

		const pdf = await buildInvoicePdf({
			title: "Payment Receipt",
			invoiceNumber: payment.merchantInvoiceNumber,
			issuedOn: paidOn,
			messName: payment.member.mess.name,
			memberName: payment.member.user.name,
			period,
			lines: [
				{ label: "Bill total for the period", amount: taka(netPayable) },
				{
					label: "Paid before this payment",
					amount: taka(
						Number(payment.bill.paidAmount) - Number(payment.amount),
					),
				},
				{
					label: `This payment (${methodLabel})`,
					amount: taka(payment.amount),
					strong: true,
				},
			],
			totalLabel: dueAmount <= 0 ? "Settled in full" : "Still outstanding",
			totalAmount: taka(Math.max(dueAmount, 0)),
			note:
				dueAmount <= 0
					? "This bill is fully paid. Keep this receipt for your records."
					: "The remaining balance can be paid any time from your bills page.",
		});

		await sendTemplateMail(
			payment.member.user.email,
			isCash
				? "Cash Payment Recorded - MessMate"
				: "Payment Received - MessMate",
			"payment-receipt",
			{
				userName: payment.member.user.name,
				messName: payment.member.mess.name,
				monthName: monthName(payment.bill.cycle.month),
				year: payment.bill.cycle.year,
				paidNow: taka(payment.amount),
				paidSoFar: taka(payment.bill.paidAmount),
				totalPayable: taka(netPayable),
				dueAmount: taka(Math.max(dueAmount, 0)),
				isFullySettled: dueAmount <= 0,
				trxId: payment.bkashTrxId ?? "-",
				isCash,
				methodLabel,
				invoice: payment.merchantInvoiceNumber,
				paidAt: paidOn,
			},
			[
				{
					filename: `messmate-receipt-${period.toLowerCase().replace(" ", "-")}.pdf`,
					content: pdf,
					contentType: "application/pdf",
				},
			],
		);
	} catch (error) {
		console.error("[payment.mail][receipt]", paymentId, error);
	}
};
