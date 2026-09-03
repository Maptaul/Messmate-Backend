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
import { getBkashIdToken } from "../../lib/bkash";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IBkashExecuteResult,
	ICreatePaymentPayload,
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

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
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
			return;
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
			return;
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
	});
};

const paymentCallback = async (query: Record<string, unknown>) => {
	const redirectTo = (status: string) =>
		`${config.frontend_url}/dashboard/my-bills?status=${status}`;

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
			member: { select: { userId: true } },
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

	const executeResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/execute`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				authorization: bkashIdToken,
				"x-app-key": config.bkash_app_key,
			},
			body: JSON.stringify({ paymentID }),
		},
	);

	const executeResult: IBkashExecuteResult = await executeResponse.json();

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

	await settlePayment(
		payment.id,
		payment.billId,
		payment.member.userId,
		amount,
		executeResult,
	);

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

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
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

export const PaymentServices = {
	getMyBills,
	createPayment,
	paymentCallback,
	getMyPayments,
	getSinglePayment,
};
