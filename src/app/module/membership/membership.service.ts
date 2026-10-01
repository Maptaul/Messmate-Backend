import httpStatus from "http-status";
import {
	AuditAction,
	MemberStatus,
	MembershipRequestKind,
	MembershipRequestStatus,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import type { MembershipRequestWhereInput } from "../../../generated/prisma/models";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import { sendTemplateMail } from "../../lib/mail";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAudit } from "../../utils/audit";
import { cacheKeys, invalidateCache } from "../../utils/cache";
import { checkMessAccess } from "../../utils/checkMessAccess";
import type {
	IInviteMemberPayload,
	IRequestToJoinPayload,
} from "./membership.interface";
import { canCancel, canDecide, newJoinCode } from "./membership.rules";
import { joinCodeSchema } from "./membership.validation";

const STATUSES: string[] = Object.values(MembershipRequestStatus);

const loginUrl = () => `${config.frontend_url}/login`;

const messSummary = {
	id: true,
	name: true,
	address: true,
	manager: { select: { name: true } },
};

const requestSelect = {
	id: true,
	kind: true,
	status: true,
	note: true,
	createdAt: true,
	decidedAt: true,
	mess: { select: messSummary },
	user: {
		select: {
			id: true,
			name: true,
			email: true,
			phone: true,
			avatarUrl: true,
		},
	},
};

const sendMail = async (
	label: string,
	...args: Parameters<typeof sendTemplateMail>
) => {
	// The decision is saved; a failed email must not turn it into an error.
	try {
		await sendTemplateMail(...args);
	} catch (error) {
		console.error(`[membership.mail][${label}]`, error);
	}
};

const findMessByCode = async (rawCode: string) => {
	const parsed = joinCodeSchema.safeParse(rawCode);

	const mess = parsed.success
		? await prisma.mess.findFirst({
				where: { joinCode: parsed.data, isDeleted: false },
				select: {
					...messSummary,
					_count: {
						select: {
							members: {
								where: { status: MemberStatus.ACTIVE, isDeleted: false },
							},
						},
					},
				},
			})
		: null;

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "No Mess Has This Join Code");
	}

	return mess;
};

/** One open invite or request per person and mess, whichever came first. */
const assertNothingPending = async (
	messId: string,
	userId: string,
	asInvite: boolean,
) => {
	const pending = await prisma.membershipRequest.findFirst({
		where: { messId, userId, status: MembershipRequestStatus.PENDING },
		select: { kind: true },
	});

	if (!pending) return;

	const askedAlready = pending.kind === MembershipRequestKind.REQUEST;
	const message = asInvite
		? askedAlready
			? "They Already Asked To Join. Approve Their Request Instead."
			: "This Person Already Has An Invitation"
		: askedAlready
			? "You Already Asked To Join This Mess"
			: "You Have An Invitation To This Mess. Accept It Instead.";

	throw new AppError(httpStatus.CONFLICT, message);
};

const assertNotMember = async (
	messId: string,
	userId: string,
	asInvite: boolean,
) => {
	const member = await prisma.messMember.findFirst({
		where: { messId, userId, status: MemberStatus.ACTIVE, isDeleted: false },
		select: { id: true },
	});

	if (member) {
		throw new AppError(
			httpStatus.CONFLICT,
			asInvite
				? "This User Is Already An Active Member Of This Mess"
				: "You Are Already A Member Of This Mess",
		);
	}
};

const loadManagedMess = async (messId: string, user: RequestUser) => {
	const mess = await prisma.mess.findFirst({
		where: { id: messId, isDeleted: false },
		select: { id: true, name: true, manager: { select: { name: true } } },
	});

	if (!mess) {
		throw new AppError(httpStatus.NOT_FOUND, "Mess Not Found");
	}

	await checkMessAccess(messId, user);

	return mess;
};

const loadPending = async (id: string) => {
	const request = await prisma.membershipRequest.findUnique({
		where: { id },
		select: {
			id: true,
			kind: true,
			status: true,
			userId: true,
			createdById: true,
			messId: true,
			mess: { select: { name: true, managerId: true, isDeleted: true } },
			user: { select: { name: true, email: true, role: true } },
		},
	});

	if (!request) {
		throw new AppError(httpStatus.NOT_FOUND, "Invitation Or Request Not Found");
	}

	if (request.status !== MembershipRequestStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Invitation Or Request Was Already Answered",
		);
	}

	return request;
};

const previewJoinCode = (code: string) => findMessByCode(code);

const requestToJoin = async (
	payload: IRequestToJoinPayload,
	user: RequestUser,
) => {
	const mess = await findMessByCode(payload.joinCode);

	await assertNotMember(mess.id, user.userId, false);
	await assertNothingPending(mess.id, user.userId, false);

	// The partial unique index stops two racing requests from both landing.
	return prisma.membershipRequest.create({
		data: {
			kind: MembershipRequestKind.REQUEST,
			messId: mess.id,
			userId: user.userId,
			createdById: user.userId,
			note: payload.note || null,
		},
		select: requestSelect,
	});
};

const inviteMember = async (
	payload: IInviteMemberPayload,
	user: RequestUser,
) => {
	const mess = await loadManagedMess(payload.messId, user);

	const invitee = await prisma.user.findFirst({
		where: { email: payload.email.trim().toLowerCase(), isDeleted: false },
		select: { id: true, name: true, email: true, role: true, status: true },
	});

	if (!invitee) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"No User Found With This Email. Ask Them To Register First.",
		);
	}

	if (invitee.role === Role.ADMIN) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"A Platform Admin Cannot Be Added As A Mess Member",
		);
	}

	if (invitee.role === Role.MESS_MANAGER) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"A Mess Manager Runs Their Own Mess And Cannot Join Another",
		);
	}

	if (invitee.status === UserStatus.BLOCKED) {
		throw new AppError(httpStatus.BAD_REQUEST, "This Account Is Blocked");
	}

	await assertNotMember(mess.id, invitee.id, true);
	await assertNothingPending(mess.id, invitee.id, true);

	const invitation = await prisma.membershipRequest.create({
		data: {
			kind: MembershipRequestKind.INVITE,
			messId: mess.id,
			userId: invitee.id,
			createdById: user.userId,
		},
		select: { id: true, kind: true, status: true, createdAt: true },
	});

	await sendMail(
		"invite",
		invitee.email,
		`You're Invited To Join ${mess.name}`,
		"membership-invite",
		{
			userName: invitee.name,
			messName: mess.name,
			managerName: mess.manager.name,
			loginUrl: loginUrl(),
		},
	);

	// Only the address the manager typed; the name stays private until they accept.
	return { ...invitation, email: invitee.email };
};

const getMyRequests = (user: RequestUser) =>
	prisma.membershipRequest.findMany({
		where: {
			userId: user.userId,
			status: MembershipRequestStatus.PENDING,
			mess: { isDeleted: false },
		},
		orderBy: { createdAt: "desc" },
		select: {
			id: true,
			kind: true,
			status: true,
			note: true,
			createdAt: true,
			mess: { select: messSummary },
		},
	});

const getMessRequests = async (
	messId: string,
	query: IQuery,
	user: RequestUser,
) => {
	await loadManagedMess(messId, user);

	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;

	const where: MembershipRequestWhereInput = {
		messId,
		status:
			query.status && STATUSES.includes(query.status)
				? (query.status as MembershipRequestStatus)
				: MembershipRequestStatus.PENDING,
	};

	const [rows, total] = await Promise.all([
		prisma.membershipRequest.findMany({
			where,
			take: limit,
			skip,
			orderBy: { createdAt: "desc" },
			select: requestSelect,
		}),
		prisma.membershipRequest.count({ where }),
	]);

	// An invite reveals nothing about the invitee until they accept it.
	const data = rows.map((row) =>
		row.kind === MembershipRequestKind.INVITE &&
		row.status !== MembershipRequestStatus.ACCEPTED
			? { ...row, user: { email: row.user.email } }
			: row,
	);

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

const answer = async (id: string, accept: boolean, actor: RequestUser) => {
	const request = await loadPending(id);

	if (!canDecide(request, actor)) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You Cannot Answer This Invitation Or Request",
		);
	}

	if (accept && request.mess.isDeleted) {
		throw new AppError(httpStatus.CONFLICT, "This Mess No Longer Exists");
	}

	if (accept && request.user.role !== Role.MEMBER) {
		throw new AppError(
			httpStatus.CONFLICT,
			"A Mess Manager Runs Their Own Mess And Cannot Join Another",
		);
	}

	await prisma.$transaction(async (tx) => {
		// Claim it while it is still pending, so a double click or a second
		// manager can't answer it twice.
		const claimed = await tx.membershipRequest.updateMany({
			where: { id, status: MembershipRequestStatus.PENDING },
			data: {
				status: accept
					? MembershipRequestStatus.ACCEPTED
					: MembershipRequestStatus.DECLINED,
				decidedById: actor.userId,
				decidedAt: new Date(),
			},
		});

		if (claimed.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"This Invitation Or Request Was Already Answered",
			);
		}

		if (!accept) return;

		const existing = await tx.messMember.findUnique({
			where: {
				messId_userId: { messId: request.messId, userId: request.userId },
			},
			select: { id: true, status: true, isDeleted: true },
		});

		const alreadyIn =
			existing?.status === MemberStatus.ACTIVE && !existing.isDeleted;

		const member = alreadyIn
			? existing
			: existing
				? await tx.messMember.update({
						where: { id: existing.id },
						data: {
							status: MemberStatus.ACTIVE,
							joinedAt: new Date(),
							leftAt: null,
							isDeleted: false,
							deletedAt: null,
						},
						select: { id: true },
					})
				: await tx.messMember.create({
						data: {
							messId: request.messId,
							userId: request.userId,
							status: MemberStatus.ACTIVE,
						},
						select: { id: true },
					});

		await writeAudit(tx, {
			actorId: actor.userId,
			action: AuditAction.MEMBER_JOINED,
			messId: request.messId,
			subjectMemberId: member.id,
			entity: "MessMember",
			entityId: member.id,
			before: { status: existing?.status ?? null },
			after: { status: MemberStatus.ACTIVE, via: request.kind },
		});
	});

	if (accept) await invalidateCache(cacheKeys.dashboardStats);

	// The person who asked hears back; a manager sees answers in the app.
	if (request.kind === MembershipRequestKind.REQUEST) {
		await sendMail(
			"answer",
			request.user.email,
			accept
				? `Welcome To ${request.mess.name}`
				: `About Your Request To Join ${request.mess.name}`,
			accept ? "membership-request-approved" : "membership-request-declined",
			{
				userName: request.user.name,
				messName: request.mess.name,
				loginUrl: loginUrl(),
			},
		);
	}

	return prisma.membershipRequest.findUnique({
		where: { id },
		select: requestSelect,
	});
};

const cancel = async (id: string, actor: RequestUser) => {
	const request = await loadPending(id);

	if (!canCancel(request, actor)) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You Cannot Withdraw This Invitation Or Request",
		);
	}

	const claimed = await prisma.membershipRequest.updateMany({
		where: { id, status: MembershipRequestStatus.PENDING },
		data: {
			status: MembershipRequestStatus.CANCELLED,
			decidedById: actor.userId,
			decidedAt: new Date(),
		},
	});

	if (claimed.count === 0) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This Invitation Or Request Was Already Answered",
		);
	}

	return prisma.membershipRequest.findUnique({
		where: { id },
		select: { id: true, kind: true, status: true, decidedAt: true },
	});
};

const regenerateJoinCode = async (messId: string, user: RequestUser) => {
	await loadManagedMess(messId, user);

	return prisma.mess.update({
		where: { id: messId },
		data: { joinCode: newJoinCode() },
		select: { id: true, joinCode: true },
	});
};

export const MembershipServices = {
	previewJoinCode,
	requestToJoin,
	inviteMember,
	getMyRequests,
	getMessRequests,
	accept: (id: string, actor: RequestUser) => answer(id, true, actor),
	decline: (id: string, actor: RequestUser) => answer(id, false, actor),
	cancel,
	regenerateJoinCode,
};
