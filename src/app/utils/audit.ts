import type { AuditAction } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";

type TAuditInput = {
	actorId: string;
	action: AuditAction;
	entity: string;
	entityId: string;
	before?: unknown;
	after?: unknown;

	messId?: string | null;

	subjectMemberId?: string | null;
};

export const writeAudit = async (
	tx: Prisma.TransactionClient | typeof prisma,
	input: TAuditInput,
) => {
	return tx.auditLog.create({
		data: {
			actorId: input.actorId,
			action: input.action,
			entity: input.entity,
			entityId: input.entityId,
			messId: input.messId ?? null,
			subjectMemberId: input.subjectMemberId ?? null,
			before: (input.before ?? undefined) as Prisma.InputJsonValue | undefined,
			after: (input.after ?? undefined) as Prisma.InputJsonValue | undefined,
		},
	});
};
