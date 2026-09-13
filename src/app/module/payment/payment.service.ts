import { randomUUID } from "node:crypto";
import httpStatus from "http-status";
import {
	AuditAction,
	BillStatus,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import type {
	MemberBillWhereInput,
	PaymentWhereInput,
} from "../../../generated/prisma/models";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import { executeBkashPayment, getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { checkMessAccess } from "../../utils/checkMessAccess";
import { sendPaymentReceipt } from "./payment.mail";
import type {
	IBkashExecuteResult,
	ICreatePaymentPayload,
	IRecordCashPaymentPayload,
} from "./payment.interface";

const billSelect = {
	id: true,
	mealCount: true,
	mealCost: true,
	sharedCost: true,
	rentShare: true,
	totalPayable: true,
	creditAmount: true,
	paidAmount: true,
	dueAmount: true,
	status: true,
	cycle: {
		select: {
			id: true,
			year: true,
			month: true,
			mess: { select: { id: true, name: true } },
		},
	},
};

const paymentSelect = {
	id: true,
	status: true,
	amount: true,
	currency: true,
	merchantInvoiceNumber: true,
	bkashPaymentId: true,
	bkashTrxId: true,
	paidAt: true,
	createdAt: true,
	bill: {
		select: {
			id: true,
			dueAmount: true,
			status: true,
			cycle: { select: { id: true, year: true, month: true } },
		},
	},
};

const findMyMemberIds = async (user: RequestUser) => {
	const memberships = await prisma.messMember.findMany({
		where: { userId: user.userId, isDeleted: false },
		select: { id: true },
	});

	return memberships.map((membership) => membership.id);
};

const getMyBills = async (query: IQuery, user: RequestUser) => {
	if (user.role === Role.ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"A Platform Admin Does Not Live In A Mess And Has No Bills",
		);
	}

	const memberIds = await findMyMemberIds(user);

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: MemberBillWhereInput[] = [
		{ memberId: { in: memberIds } },
	];

	if (query.status) {
		andConditions.push({ status: query.status as BillStatus });
	}

	const bills = await prisma.memberBill.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: sortOrder },
		select: billSelect,
	});

	const total = await prisma.memberBill.count({
		where: { AND: andConditions },
	});

	return {
		data: bills,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const createPayment = async (
	payload: ICreatePaymentPayload,
	user: RequestUser,
) => {
	const bill = await prisma.memberBill.findUnique({
		where: { id: payload.billId },
		select: {
			id: true,
			memberId: true,
			dueAmount: true,
			status: true,
			member: { select: { messId: true } },
		},
	});

	if (!bill) {
		throw new AppError(httpStatus.NOT_FOUND, "Bill Not Found");
	}

	const membership = await checkMessAccess(bill.member.messId, user);

	if (!membership || membership.id !== bill.memberId) {
		throw new AppError(httpStatus.FORBIDDEN, "You Can Only Pay Your Own Bill");
	}

	if (bill.status === BillStatus.PAID) {
		throw new AppError(httpStatus.CONFLICT, "This Bill Is Already Paid");
	}

	const dueAmount = Number(bill.dueAmount);

	if (dueAmount <= 0) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Bill Has Nothing Left To Pay",
		);
	}

	const paymentId = randomUUID();
	const amount = dueAmount.toFixed(2);

	const payment = await prisma.payment.create({
		data: {
			id: paymentId,
			merchantInvoiceNumber: paymentId,
			billId: bill.id,
			memberId: bill.memberId,
			amount: dueAmount,
			payerReference: user.email,
		},
		select: { id: true },
	});

	const bkashIdToken = await getBkashIdToken();

	if (!bkashIdToken) {
		throw new AppError(httpStatus.BAD_GATEWAY, "Bkash Token Is Unavailable");
	}

	const createResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				authorization: bkashIdToken,
				"x-app-key": config.bkash_app_key,
			},
			body: JSON.stringify({
				mode: "0011",
				payerReference: user.email,
				callbackURL: `${config.bkash_callback_url}/payment/callback`,
				amount,
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber: payment.id,
			}),
		},
	);

	const createResult = await createResponse.json();

	if (!createResponse.ok || !createResult.bkashURL) {
		await prisma.payment.update({
			where: { id: payment.id },
			data: { status: PaymentStatus.FAILED, gatewayResponse: createResult },
		});

		throw new AppError(
			httpStatus.BAD_GATEWAY,
			"Bkash Refused To Start This Payment",
		);
	}

	await prisma.payment.update({
		where: { id: payment.id },
		data: {
			bkashPaymentId: createResult.paymentID,
			gatewayResponse: createResult,
		},
	});

	return {
		paymentId: payment.id,
		amount,
		paymentUrl: createResult.bkashURL,
	};
};

const settlePayment = async (
	paymentId: string,
	billId: string,
	actorId: string,
	messId: string,
	memberId: string,
	amount: number,
	executeResult: IBkashExecuteResult,
) => {
	return prisma.$transaction(async (tx) => {
		const claimed = await tx.payment.updateMany({
			where: { id: paymentId, status: PaymentStatus.UNPAID },
			data: {
				status: PaymentStatus.PAID,
				bkashTrxId: executeResult.trxID,

				paidAt: new Date(),
				gatewayResponse: executeResult as object,
			},
		});

		if (claimed.count === 0) {
			return false;
		}

		const bill = await tx.memberBill.findUnique({
			where: { id: billId },
			select: {
				id: true,
				totalPayable: true,
				creditAmount: true,
				paidAmount: true,
			},
		});

		if (!bill) {
			return false;
		}

		const paidAmount = Number(bill.paidAmount) + amount;
		const dueAmount =
			Number(bill.totalPayable) - Number(bill.creditAmount) - paidAmount;

		await tx.memberBill.update({
			where: { id: bill.id },
			data: {
				paidAmount,
				dueAmount,
				status: dueAmount <= 0 ? BillStatus.PAID : BillStatus.PARTIAL,
			},
		});

		await writeAudit(tx, {
			actorId,
			action: AuditAction.PAYMENT_SETTLED,
			messId,
			subjectMemberId: memberId,
			entity: "Payment",
			entityId: paymentId,
			before: { status: PaymentStatus.UNPAID },
			after: {
				status: PaymentStatus.PAID,
				amount,
				bkashTrxId: executeResult.trxID,
				billPaidAmount: paidAmount,
				billDueAmount: dueAmount,
			},
		});

		return true;
	});
};

const paymentCallback = async (query: Record<string, unknown>) => {
	const redirectTo = (status: string) =>
		config.payment_result_url
			? `${config.payment_result_url}?status=${status}`
			: `${config.backend_url}/api/v1/payment/result?status=${status}`;

	const paymentID = typeof query.paymentID === "string" ? query.paymentID : "";
	const status = typeof query.status === "string" ? query.status : "";

	if (!paymentID) {
		return { redirectUrl: redirectTo("failure") };
	}

	const payment = await prisma.payment.findUnique({
		where: { bkashPaymentId: paymentID },
		select: {
			id: true,
			billId: true,
			amount: true,
			status: true,
			memberId: true,
			member: { select: { userId: true, messId: true } },
		},
	});

	if (!payment) {
		return { redirectUrl: redirectTo("failure") };
	}

	if (payment.status === PaymentStatus.PAID) {
		return { redirectUrl: redirectTo("success") };
	}

	if (status === "cancel" || status === "failure") {
		await prisma.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.UNPAID },
			data: {
				status:
					status === "cancel" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
			},
		});

		return { redirectUrl: redirectTo(status) };
	}

	const bkashIdToken = await getBkashIdToken();

	if (!bkashIdToken) {
		return { redirectUrl: redirectTo("failure") };
	}

	const executeResult = await executeBkashPayment(bkashIdToken, paymentID);

	if (!executeResult) {
		return { redirectUrl: redirectTo("failure") };
	}

	const amount = Number(payment.amount);

	const isVerified =
		executeResult.statusCode === "0000" &&
		executeResult.transactionStatus === "Completed" &&
		executeResult.currency === "BDT" &&
		Number(executeResult.amount) === amount;

	if (!isVerified) {
		await prisma.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.UNPAID },
			data: {
				status: PaymentStatus.FAILED,
				gatewayResponse: executeResult as object,
			},
		});

		return { redirectUrl: redirectTo("failure") };
	}

	const settled = await settlePayment(
		payment.id,
		payment.billId,
		payment.member.userId,
		payment.member.messId,
		payment.memberId,
		amount,
		executeResult,
	);

	if (settled) {
		await sendPaymentReceipt(payment.id);
	}

	return { redirectUrl: redirectTo("success") };
};

const getMyPayments = async (query: IQuery, user: RequestUser) => {
	if (user.role === Role.ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"A Platform Admin Does Not Live In A Mess And Has No Payments",
		);
	}

	const memberIds = await findMyMemberIds(user);

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: PaymentWhereInput[] = [{ memberId: { in: memberIds } }];

	if (query.status) {
		andConditions.push({ status: query.status as PaymentStatus });
	}

	const payments = await prisma.payment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: sortOrder },
		select: paymentSelect,
	});

	const total = await prisma.payment.count({ where: { AND: andConditions } });

	return {
		data: payments,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const getSinglePayment = async (paymentId: string, user: RequestUser) => {
	const payment = await prisma.payment.findUnique({
		where: { id: paymentId },
		select: {
			...paymentSelect,
			member: { select: { id: true, messId: true } },
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment Not Found");
	}

	if (user.role !== Role.ADMIN) {
		const membership = await checkMessAccess(payment.member.messId, user);

		if (!membership || membership.id !== payment.member.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You Are Not Allowed To View This Payment",
			);
		}
	}

	return payment;
};

const getCycleBills = async (
	cycleId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, year: true, month: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can See Everybody's Bills",
		);
	}

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;

	const andConditions: MemberBillWhereInput[] = [{ cycleId }];

	if (query.status) {
		andConditions.push({ status: query.status as BillStatus });
	}

	if (query.searchTerm) {
		andConditions.push({
			member: {
				user: {
					OR: [
						{ name: { contains: query.searchTerm, mode: "insensitive" } },
						{ email: { contains: query.searchTerm, mode: "insensitive" } },
					],
				},
			},
		});
	}

	const where: MemberBillWhereInput = { AND: andConditions };

	const [bills, total] = await Promise.all([
		prisma.memberBill.findMany({
			where,
			skip,
			take: limit,
			orderBy: { dueAmount: "desc" },
			select: {
				id: true,
				mealCount: true,
				mealCost: true,
				sharedCost: true,
				rentShare: true,
				totalPayable: true,
				creditAmount: true,
				paidAmount: true,
				dueAmount: true,
				status: true,
				member: {
					select: {
						id: true,
						user: { select: { name: true, email: true } },
					},
				},
			},
		}),
		prisma.memberBill.count({ where }),
	]);

	return {
		data: bills,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const recordCashPayment = async (
	payload: IRecordCashPaymentPayload,
	user: RequestUser,
) => {
	const bill = await prisma.memberBill.findUnique({
		where: { id: payload.billId },
		select: {
			id: true,
			memberId: true,
			totalPayable: true,
			creditAmount: true,
			paidAmount: true,
			dueAmount: true,
			status: true,
			member: { select: { messId: true } },
		},
	});

	if (!bill) {
		throw new AppError(httpStatus.NOT_FOUND, "Bill Not Found");
	}

	await checkMessAccess(bill.member.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Record A Cash Payment",
		);
	}

	if (bill.status === BillStatus.PAID) {
		throw new AppError(httpStatus.CONFLICT, "This Bill Is Already Paid");
	}

	const outstanding = Number(bill.dueAmount);

	if (outstanding <= 0) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Bill Has Nothing Left To Pay",
		);
	}

	const amount = Number(payload.amount.toFixed(2));

	if (amount > outstanding) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`This Bill Only Has ${outstanding.toFixed(2)} Left To Pay`,
		);
	}

	const paymentId = randomUUID();

	const settled = await prisma.$transaction(async (tx) => {
		const claimed = await tx.memberBill.updateMany({
			where: { id: bill.id, paidAmount: bill.paidAmount },
			data: {
				paidAmount: Number(bill.paidAmount) + amount,
				dueAmount: outstanding - amount,
				status:
					outstanding - amount <= 0 ? BillStatus.PAID : BillStatus.PARTIAL,
			},
		});

		if (claimed.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This Bill Changed While The Payment Was Being Recorded. Please Try Again.",
			);
		}

		const payment = await tx.payment.create({
			data: {
				id: paymentId,
				merchantInvoiceNumber: paymentId,
				billId: bill.id,
				memberId: bill.memberId,
				amount,
				status: PaymentStatus.PAID,
				paymentGateway: "cash",
				payerReference: user.email,
				paidAt: new Date(),
				gatewayResponse: payload.note ? { note: payload.note } : undefined,
			},
			select: {
				id: true,
				amount: true,
				status: true,
				paymentGateway: true,
				paidAt: true,
			},
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.PAYMENT_SETTLED,
			messId: bill.member.messId,
			subjectMemberId: bill.memberId,
			entity: "Payment",
			entityId: paymentId,
			before: { status: PaymentStatus.UNPAID },
			after: {
				status: PaymentStatus.PAID,
				amount,
				paymentGateway: "cash",
				billPaidAmount: Number(bill.paidAmount) + amount,
				billDueAmount: outstanding - amount,
				note: payload.note ?? null,
			},
		});

		return payment;
	});

	await sendPaymentReceipt(paymentId);

	return settled;
};

export const PaymentServices = {
	getMyBills,
	createPayment,
	getCycleBills,
	recordCashPayment,
	paymentCallback,
	getMyPayments,
	getSinglePayment,
};
