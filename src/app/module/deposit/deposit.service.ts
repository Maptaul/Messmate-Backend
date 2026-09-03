import httpStatus from "http-status";
import {
	AuditAction,
	CycleStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { DepositWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IAddDepositPayload,
	IUpdateDepositPayload,
} from "./deposit.interface";

const depositSelect = {
	id: true,
	amount: true,
	note: true,
	createdAt: true,
	member: {
		select: {
			id: true,
			user: { select: { id: true, name: true, email: true } },
		},
	},
	createdBy: { select: { id: true, name: true } },
};

const loadWritableCycle = async (cycleId: string, user: RequestUser) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, status: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	if (user.role === Role.MEMBER) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only The Mess Manager Can Record Deposits",
		);
	}

	if (cycle.status !== CycleStatus.OPEN) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Cycle Is Closed. Reopen It To Change Deposits.",
		);
	}

	return cycle;
};

const addDeposit = async (payload: IAddDepositPayload, user: RequestUser) => {
	const cycle = await loadWritableCycle(payload.cycleId, user);

	const member = await prisma.messMember.findFirst({
		where: { id: payload.memberId, messId: cycle.messId, isDeleted: false },
		select: { id: true },
	});

	if (!member) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"This Member Does Not Belong To This Mess",
		);
	}

	return prisma.deposit.create({
		data: {
			cycleId: cycle.id,
			memberId: payload.memberId,
			amount: payload.amount,
			note: payload.note ?? null,
			createdById: user.userId,
		},
		select: depositSelect,
	});
};

const getCycleDeposits = async (
	cycleId: string,
	query: IQuery,
	user: RequestUser,
) => {
	const cycle = await prisma.billingCycle.findUnique({
		where: { id: cycleId },
		select: { id: true, messId: true },
	});

	if (!cycle) {
		throw new AppError(httpStatus.NOT_FOUND, "Billing Cycle Not Found");
	}

	await checkMessAccess(cycle.messId, user);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: DepositWhereInput[] = [{ cycleId, isDeleted: false }];

	if (query.memberId) {
		andConditions.push({ memberId: query.memberId });
	}

	const deposits = await prisma.deposit.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: sortOrder },
		select: depositSelect,
	});

	const total = await prisma.deposit.count({ where: { AND: andConditions } });

	return {
		data: deposits,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const updateDeposit = async (
	depositId: string,
	payload: IUpdateDepositPayload,
	user: RequestUser,
) => {
	const deposit = await prisma.deposit.findFirst({
		where: { id: depositId, isDeleted: false },
		select: { id: true, cycleId: true },
	});

	if (!deposit) {
		throw new AppError(httpStatus.NOT_FOUND, "Deposit Not Found");
	}

	await loadWritableCycle(deposit.cycleId, user);

	return prisma.deposit.update({
		where: { id: depositId },
		data: { amount: payload.amount, note: payload.note },
		select: depositSelect,
	});
};

const deleteDeposit = async (depositId: string, user: RequestUser) => {
	const deposit = await prisma.deposit.findFirst({
		where: { id: depositId, isDeleted: false },
		select: { id: true, cycleId: true, amount: true, memberId: true },
	});

	if (!deposit) {
		throw new AppError(httpStatus.NOT_FOUND, "Deposit Not Found");
	}

	await loadWritableCycle(deposit.cycleId, user);

	return prisma.$transaction(async (tx) => {
		const removed = await tx.deposit.update({
			where: { id: depositId },
			data: { isDeleted: true, deletedAt: new Date() },
			select: { id: true, amount: true, isDeleted: true, deletedAt: true },
		});

		await writeAudit(tx, {
			actorId: user.userId,
			action: AuditAction.DEPOSIT_DELETED,
			entity: "Deposit",
			entityId: depositId,
			before: { amount: Number(deposit.amount), memberId: deposit.memberId },
			after: { isDeleted: true },
		});

		return removed;
	});
};

export const DepositServices = {
	addDeposit,
	getCycleDeposits,
	updateDeposit,
	deleteDeposit,
};
