import httpStatus from "http-status";
import {
	AuditAction,
	ManagerApplicationStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { ManagerApplicationWhereInput } from "../../../generated/prisma/models";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import { sendTemplateMail } from "../../lib/mail";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { cacheKeys, invalidateCache } from "../../utils/cache";
import type {
	IApplyForManagerPayload,
	IReviewManagerRequestPayload,
} from "./managerRequest.interface";

const STATUSES: string[] = Object.values(ManagerApplicationStatus);

const requestSelect = {
	id: true,
	messName: true,
	messAddress: true,
	status: true,
	rejectionReason: true,
	reviewedAt: true,
	createdAt: true,
	user: {
		select: {
			id: true,
			name: true,
			email: true,
			phone: true,
			role: true,
			avatarUrl: true,
			createdAt: true,
		},
	},
};

const applyForManager = async (
	payload: IApplyForManagerPayload,
	user: RequestUser,
) => {
	const pending = await prisma.managerApplication.findFirst({
		where: { userId: user.userId, status: ManagerApplicationStatus.PENDING },
		select: { id: true },
	});

	if (pending) {
		throw new AppError(
			httpStatus.CONFLICT,
			"You Already Have A Request Waiting For Review",
		);
	}

	// A partial unique index allows one PENDING row per user, so two requests
	// racing past the check above still end in a single application (P2002).
	return prisma.managerApplication.create({
		data: {
			userId: user.userId,
			messName: payload.messName,
			messAddress: payload.messAddress,
		},
		select: requestSelect,
	});
};

const getAllRequests = async (query: IQuery) => {
	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: ManagerApplicationWhereInput[] = [];

	if (query.status && STATUSES.includes(query.status)) {
		andConditions.push({ status: query.status as ManagerApplicationStatus });
	}

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ messName: { contains: query.searchTerm, mode: "insensitive" } },
				{ user: { name: { contains: query.searchTerm, mode: "insensitive" } } },
				{
					user: { email: { contains: query.searchTerm, mode: "insensitive" } },
				},
			],
		});
	}

	const where = { AND: andConditions };

	const [requests, total] = await Promise.all([
		prisma.managerApplication.findMany({
			where,
			take: limit,
			skip,
			orderBy: { createdAt: sortOrder },
			select: requestSelect,
		}),
		prisma.managerApplication.count({ where }),
	]);

	return {
		data: requests,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

const reviewRequest = async (
	payload: IReviewManagerRequestPayload,
	reviewer: RequestUser,
) => {
	const request = await prisma.managerApplication.findUnique({
		where: { id: payload.requestId },
		select: {
			id: true,
			status: true,
			messName: true,
			user: {
				select: { id: true, name: true, email: true, role: true },
			},
		},
	});

	if (!request) {
		throw new AppError(httpStatus.NOT_FOUND, "Manager Request Not Found");
	}

	if (request.status !== ManagerApplicationStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Request Has Already Been Reviewed",
		);
	}

	const approved = payload.status === ManagerApplicationStatus.APPROVED;
	const { user } = request;
	const roleAfter =
		approved && user.role === Role.MEMBER ? Role.MESS_MANAGER : user.role;

	await prisma.$transaction(async (tx) => {
		// Claim the request while it is still pending, so two admins reviewing
		// at once can't both act on it.
		const claimed = await tx.managerApplication.updateMany({
			where: { id: request.id, status: ManagerApplicationStatus.PENDING },
			data: {
				status: payload.status,
				rejectionReason: approved ? null : payload.rejectionReason,
				reviewedBy: reviewer.userId,
				reviewedAt: new Date(),
			},
		});

		if (claimed.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This Request Has Already Been Reviewed",
			);
		}

		if (roleAfter !== user.role) {
			await tx.user.update({
				where: { id: user.id },
				data: { role: roleAfter },
			});
		}

		await writeAudit(tx, {
			actorId: reviewer.userId,
			action: approved
				? AuditAction.MANAGER_APPROVED
				: AuditAction.MANAGER_REJECTED,
			entity: "User",
			entityId: user.id,
			before: { status: ManagerApplicationStatus.PENDING, role: user.role },
			after: {
				status: payload.status,
				role: roleAfter,
				messName: request.messName,
				rejectionReason: approved ? null : payload.rejectionReason,
			},
		});
	});

	await invalidateCache(cacheKeys.dashboardStats);

	// The decision is saved; a failed email must not turn it into an error.
	try {
		await sendTemplateMail(
			user.email,
			approved
				? "You Can Now Run Your Mess On MessMate"
				: "About Your Request To Run A Mess",
			approved ? "manager-request-approved" : "manager-request-rejected",
			{
				userName: user.name,
				messName: request.messName,
				reason: payload.rejectionReason,
				loginUrl: `${config.frontend_url}/login`,
			},
		);
	} catch (error) {
		console.error("[managerRequest.mail][review]", request.id, error);
	}

	return prisma.managerApplication.findUnique({
		where: { id: request.id },
		select: requestSelect,
	});
};

export const ManagerRequestServices = {
	applyForManager,
	getAllRequests,
	reviewRequest,
};
