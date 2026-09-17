import {
	BillStatus,
	CycleStatus,
	MemberStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { sendTemplateMail } from "../../lib/mail";
import { prisma } from "../../lib/prisma";
import { mapWithLimit } from "../../utils/concurrency";
import { monthName, taka } from "../../utils/months";
import {
	buildPlanDays,
	lockInDefaultMeals,
} from "../mealPlan/mealPlan.service";

const DHAKA_UTC_OFFSET_HOURS = 6;

const MAIL_CONCURRENCY = 4;

export const dhakaDateOnly = (now: Date, addDays = 0) => {
	const dhakaNow = new Date(
		now.getTime() + DHAKA_UTC_OFFSET_HOURS * 60 * 60 * 1000,
	);

	return new Date(
		Date.UTC(
			dhakaNow.getUTCFullYear(),
			dhakaNow.getUTCMonth(),
			dhakaNow.getUTCDate() + addDays,
		),
	);
};

type Recipient = {
	email: string;
	subject: string;
	template: string;
	data: Record<string, unknown>;
};

const deliver = async (recipients: Recipient[], dryRun: boolean) => {
	if (dryRun) {
		return { sent: 0, failed: 0, recipients: recipients.map((r) => r.email) };
	}

	const outcomes = await mapWithLimit(
		recipients,
		MAIL_CONCURRENCY,
		(recipient) =>
			sendTemplateMail(
				recipient.email,
				recipient.subject,
				recipient.template,
				recipient.data,
			),
	);

	let sent = 0;
	let failed = 0;

	outcomes.forEach((outcome, index) => {
		if (outcome.status === "fulfilled") {
			sent += 1;
			return;
		}

		failed += 1;

		console.error(
			"[cron.service][deliver]",
			recipients[index]?.template,
			recipients[index]?.email,
			outcome.reason,
		);
	});

	return { sent, failed, recipients: recipients.map((r) => r.email) };
};

const sendMealPlanReminders = async (dryRun: boolean) => {
	const tomorrow = dhakaDateOnly(new Date(), 1);

	const openCycles = await prisma.billingCycle.findMany({
		where: { status: CycleStatus.OPEN },
		select: { id: true, messId: true, mess: { select: { name: true } } },
	});

	const recipients: Recipient[] = [];

	for (const cycle of openCycles) {
		const members = await prisma.messMember.findMany({
			where: {
				messId: cycle.messId,
				status: MemberStatus.ACTIVE,
				isDeleted: false,
				mealPlans: { none: { date: tomorrow } },

				defaultLunch: 0,
				defaultDinner: 0,
			},
			select: { user: { select: { name: true, email: true } } },
		});

		for (const member of members) {
			recipients.push({
				email: member.user.email,
				subject: "Set Your Meals For Tomorrow",
				template: "meal-plan-reminder",
				data: {
					userName: member.user.name,
					messName: cycle.mess.name,
					planDate: tomorrow.toISOString().slice(0, 10),
					loginUrl: `${config.frontend_url}/login`,
				},
			});
		}
	}

	const result = await deliver(recipients, dryRun);

	return { planDate: tomorrow.toISOString().slice(0, 10), ...result };
};

// Runs just after the 23:00 cutoff: tomorrow is locked, so defaults are
// written in as real plans and the manager gets the final count to shop for.
const sendMealHeadcounts = async (dryRun: boolean) => {
	const tomorrow = dhakaDateOnly(new Date(), 1);

	const openCycles = await prisma.billingCycle.findMany({
		where: {
			status: CycleStatus.OPEN,
			year: tomorrow.getUTCFullYear(),
			month: tomorrow.getUTCMonth() + 1,
		},
		select: {
			id: true,
			messId: true,
			year: true,
			month: true,
			mess: {
				select: {
					name: true,
					manager: { select: { name: true, email: true } },
				},
			},
		},
	});

	const recipients: Recipient[] = [];

	for (const cycle of openCycles) {
		if (!dryRun) {
			await lockInDefaultMeals(cycle, tomorrow);
		}

		const [day] = await buildPlanDays(cycle, tomorrow);

		if (!day) {
			continue;
		}

		recipients.push({
			email: cycle.mess.manager.email,
			subject: `Tomorrow At ${cycle.mess.name}: ${day.lunch} Lunch, ${day.dinner} Dinner`,
			template: "meal-headcount",
			data: {
				userName: cycle.mess.manager.name,
				messName: cycle.mess.name,
				planDate: day.date,
				lunch: day.lunch,
				dinner: day.dinner,
				members: day.members,
			},
		});
	}

	const result = await deliver(recipients, dryRun);

	return { planDate: tomorrow.toISOString().slice(0, 10), ...result };
};

const sendUnpaidBillReminders = async (dryRun: boolean) => {
	const bills = await prisma.memberBill.findMany({
		where: {
			status: { in: [BillStatus.UNPAID, BillStatus.PARTIAL] },
			dueAmount: { gt: 0 },
			cycle: { status: CycleStatus.CLOSED },
		},
		select: {
			dueAmount: true,
			cycle: { select: { year: true, month: true } },
			member: {
				select: {
					mess: { select: { name: true } },
					user: { select: { name: true, email: true } },
				},
			},
		},
	});

	const recipients: Recipient[] = bills.map((bill) => ({
		email: bill.member.user.email,
		subject: "Your MessMate Bill Is Still Unpaid",
		template: "unpaid-bill-reminder",
		data: {
			userName: bill.member.user.name,
			messName: bill.member.mess.name,
			monthName: monthName(bill.cycle.month),
			year: bill.cycle.year,
			dueAmount: taka(bill.dueAmount),
			loginUrl: `${config.frontend_url}/login`,
		},
	}));

	const result = await deliver(recipients, dryRun);

	return result;
};

export const CronServices = {
	sendMealPlanReminders,
	sendMealHeadcounts,
	sendUnpaidBillReminders,
};
