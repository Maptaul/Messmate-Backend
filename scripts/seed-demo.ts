/**
 * Demo data: three messes with their managers and twelve members, three
 * closed months and the current one open, so every screen has real numbers.
 *
 *   pnpm seed:demo           prints the plan and each member's newest bill
 *   pnpm seed:demo --write   replaces the demo data in DATABASE_URL
 *
 * Writing first deletes the mess the demo manager runs and every account on
 * @messmate.test, so running it again resets the demo. Months count back from
 * today in Dhaka. Closing a month, cash payments and the open month go through
 * the app's own services; older meals, bills and deposits are inserted with
 * backdated timestamps. No mail is sent.
 */
import bcrypt from "bcryptjs";
import config from "../src/app/config";
import { transporter } from "../src/app/lib/nodemailer";
import { prisma } from "../src/app/lib/prisma";
import { redisClient } from "../src/app/lib/redis";
import type { RequestUser } from "../src/app/middleware/checkAuth";
import { dhakaDateOnly } from "../src/app/module/cron/cron.service";
import { CycleServices } from "../src/app/module/cycle/cycle.service";
import { computeSettlement } from "../src/app/module/cycle/cycle.settlement";
import { DepositServices } from "../src/app/module/deposit/deposit.service";
import { ExpenseServices } from "../src/app/module/expense/expense.service";
import { GroceryDutyServices } from "../src/app/module/groceryDuty/groceryDuty.service";
import { MealServices } from "../src/app/module/meal/meal.service";
import { MealPlanServices } from "../src/app/module/mealPlan/mealPlan.service";
import { PaymentServices } from "../src/app/module/payment/payment.service";
import { cacheKeys, invalidateCache } from "../src/app/utils/cache";
import {
	AuditAction,
	type ExpenseType,
	type FinanceCategory,
	type FinanceEntryType,
	ManagerApplicationStatus,
	MemberStatus,
	MembershipRequestKind,
	MembershipRequestStatus,
	Role,
	type SplitMethod,
} from "../src/generated/prisma/enums";

const WRITE = process.argv.includes("--write");
// Reserved by RFC 2606: mail to it never leaves the building.
const DOMAIN = "messmate.test";

// ---------- time ----------

const DAY_MS = 86_400_000;
const NOW = new Date();
const TODAY = dhakaDateOnly(NOW);

// Three closed months, then the one we are in.
const MONTHS = [3, 2, 1, 0].map((back) => {
	const first = new Date(
		Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth() - back, 1),
	);
	return { year: first.getUTCFullYear(), month: first.getUTCMonth() + 1 };
});
const LAST_CLOSED = 2;
const OPEN = 3;

const day = (m: number, d: number) =>
	new Date(Date.UTC(MONTHS[m]!.year, MONTHS[m]!.month - 1, d));
const daysIn = (m: number) =>
	new Date(Date.UTC(MONTHS[m]!.year, MONTHS[m]!.month, 0)).getUTCDate();
const addDays = (date: Date, n: number) =>
	new Date(date.getTime() + n * DAY_MS);
// A Dhaka wall-clock hour on a date, as an instant.
const at = (date: Date, hour: number) =>
	new Date(date.getTime() + (hour - 6) * 3_600_000);
const past = (instant: Date) =>
	instant < NOW ? instant : new Date(NOW.getTime() - 60_000);
// Days with meals on record: whole months, or up to yesterday in this one.
const recordedDays = (m: number) =>
	m === OPEN ? TODAY.getUTCDate() - 1 : daysIn(m);

const FOUNDED = addDays(day(0, 1), -5);

// Same numbers on every run, so the plan printed is the data written.
let seed = 20261002;
const random = () => {
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!;
const round10 = (n: number) => Math.round(n / 10) * 10;

// ---------- who ----------

type Habit = "regular" | "half" | "lunchOnly";
type Pay = "full" | "half" | "none";

type Person = {
	name: string;
	email: string;
	story: string;
	habit?: Habit;
	via?: MembershipRequestKind;
	joined?: Date;
	left?: Date;
	away?: [Date, Date];
	deposits?: (m: number) => number[];
	lastBill?: Pay;
	buysGrocery?: boolean;
	finance?: "tutor" | "job";
};

type MessSpec = {
	name: string;
	address: string;
	monthlyRent: number;
	maid: number;
	manager: Person;
	members: Person[];
};

const testEmail = (local: string) => `${local}@${DOMAIN}`;

const MESSES: MessSpec[] = [
	{
		name: "Shanti Niloy Bachelor Mess",
		address: "House 14, Road 3, Shantinagar, Dhaka 1217",
		monthlyRent: 22500,
		maid: 3000,
		manager: {
			name: config.demo_manager_name,
			email: config.demo_manager_email,
			story: "Demo manager",
		},
		members: [
			{
				name: config.demo_member_name,
				email: config.demo_member_email,
				story: "Newest bill unpaid: pay it by card or bKash",
				lastBill: "none",
				finance: "tutor",
			},
			{
				name: "Rafiul Islam",
				email: testEmail("rafiul"),
				story: "Buys groceries on his duty week with his own money",
				buysGrocery: true,
			},
			{
				name: "Arif Hasan",
				email: testEmail("arif"),
				story: "Paid half of the newest bill in cash",
				lastBill: "half",
			},
			{
				name: "Nayeem Khan",
				email: testEmail("nayeem"),
				story: "Joined mid-month with the join code, often half a lunch",
				habit: "half",
				via: MembershipRequestKind.REQUEST,
				joined: day(1, 12),
			},
		],
	},
	{
		name: "Green Villa Students' Mess",
		address: "House 27, Road 11, Section 10, Mirpur, Dhaka 1216",
		monthlyRent: 20000,
		maid: 2800,
		manager: {
			name: "Tanvir Ahmed",
			email: testEmail("tanvir"),
			story: "Manager, approved by the admin",
		},
		members: [
			{
				name: "Sakib Al Mamun",
				email: testEmail("sakib"),
				story: "Deposited more than his bill: the mess owes him",
				deposits: (m) => (m === LAST_CLOSED ? [6000, 6000] : [2500]),
			},
			{
				name: "Imran Chowdhury",
				email: testEmail("imran"),
				story: "Credit from the month before carried in as opening balance",
				deposits: (m) => (m === LAST_CLOSED - 1 ? [12000] : [2500]),
			},
			{
				name: "Fahim Rahman",
				email: testEmail("fahim"),
				story: "Home for ten days: no meals, still pays his rent",
				away: [day(LAST_CLOSED, 10), day(LAST_CLOSED, 19)],
			},
			{
				name: "Jubayer Ahmed",
				email: testEmail("jubayer"),
				story: "Left mid-month: rent counted to the day he left",
				left: day(LAST_CLOSED, 15),
			},
		],
	},
	{
		name: "Nirob Chhaya Mess",
		address: "28/2 Lalbagh Road, Azimpur, Dhaka 1205",
		monthlyRent: 17500,
		maid: 2500,
		manager: {
			name: "Sabbir Hossain",
			email: testEmail("sabbir"),
			story: "Manager, approved by the admin",
		},
		members: [
			{
				name: "Mahmudul Hasan",
				email: testEmail("mahmudul"),
				story: "Lunch only, set as his default",
				habit: "lunchOnly",
			},
			{
				name: "Rakibul Islam",
				email: testEmail("rakibul"),
				story: "Deposits in three instalments a month",
				deposits: () => [1500, 1500, 1500],
			},
			{
				name: "Shakil Ahmed",
				email: testEmail("shakil"),
				story: "Newest bill unpaid: a second account to try bKash",
				lastBill: "none",
			},
			{
				name: "Tahsin Kabir",
				email: testEmail("tahsin"),
				story: "Keeps his own income and spending in MessMate",
				finance: "job",
			},
		],
	},
];

const ASKER = {
	name: "Ashik Mahmud",
	email: testEmail("ashik"),
	note: "Rafiul bhai gave me the code. I can move in from the 10th.",
};
const INVITEE = { name: "Riyad Hasan", email: testEmail("riyad") };
const POSTMAN_MANAGER = {
	name: "Postman Manager",
	email: testEmail("postman.manager"),
};
const POSTMAN_MEMBER = { name: "Postman Member", email: testEmail("postman.member") };
const APPLICANT = {
	name: "Mehedi Hasan",
	email: testEmail("mehedi"),
	messName: "Lake View Bachelor Mess",
	messAddress: "House 9, Road 7A, Dhanmondi, Dhaka 1209",
};

const rosterOf = (mess: MessSpec) => [mess.manager, ...mess.members];
const joinedOf = (p: Person) => p.joined ?? FOUNDED;
const isMember = (p: Person, date: Date) =>
	joinedOf(p) <= date && (!p.left || date <= p.left);
const isHome = (p: Person, date: Date) =>
	isMember(p, date) && !(p.away && p.away[0] <= date && date <= p.away[1]);
// Members the month's settlement sees: everyone who had joined by its end.
const billedIn = (p: Person, m: number) => joinedOf(p) <= day(m, daysIn(m));

// ---------- the ledger ----------

type Expense = {
	type: ExpenseType;
	amount: number;
	splitMethod: SplitMethod;
	description: string;
	spentAt: Date;
	paidBy: number | null;
};

type Ledger = {
	meals: { who: number; date: Date; lunch: number; dinner: number }[];
	expenses: Expense[];
	deposits: { who: number; amount: number; at: Date; note: string | null }[];
	duties: { who: number; startDate: Date; endDate: Date }[];
};

const GROCERIES = [
	"Rice, dal and vegetables",
	"Rui fish, potatoes and onions",
	"Broiler chicken, oil and spices",
	"Eggs, vegetables and green chillies",
	"Beef for Friday, salad",
	"Rice sack (25 kg) and lentils",
	"Pangas fish, vegetables",
	"Soybean oil, onions, garlic",
];

const mealsFor = (habit: Habit = "regular") => {
	if (habit === "lunchOnly") return { lunch: random() < 0.1 ? 0 : 1, dinner: 0 };
	if (habit === "half")
		return {
			lunch: random() < 0.5 ? 0.5 : 1,
			dinner: random() < 0.1 ? 0.5 : 1,
		};
	return { lunch: random() < 0.12 ? 0 : 1, dinner: random() < 0.05 ? 2 : 1 };
};

const dutiesFor = (roster: Person[], m: number) => {
	const duties: Ledger["duties"] = [];
	let turn = m;
	for (let start = 1; start <= daysIn(m); start += 7) {
		const here = roster.flatMap((p, i) => (isHome(p, day(m, start)) ? [i] : []));
		duties.push({
			who: here[turn++ % here.length]!,
			startDate: day(m, start),
			endDate: day(m, Math.min(start + 6, daysIn(m))),
		});
	}
	return duties;
};

const sharedBills = (mess: MessSpec, m: number): Expense[] =>
	[
		["INTERNET", 1000, "EQUAL", "Broadband, 40 Mbps", 5],
		["GAS", 1150, "BY_MEAL", "Gas cylinder (12 kg)", 6],
		["ELECTRICITY", round10(1300 + random() * 700), "EQUAL", "Prepaid meter recharge", 9],
		["WATER", 400, "EQUAL", "WASA water bill", 12],
		["MAID", mess.maid, "EQUAL", "Khala's salary", daysIn(m)],
	].map(([type, amount, splitMethod, description, d]) => ({
		type: type as ExpenseType,
		amount: amount as number,
		splitMethod: splitMethod as SplitMethod,
		description: description as string,
		spentAt: day(m, d as number),
		paidBy: null,
	}));

const ledgerFor = (mess: MessSpec, m: number): Ledger => {
	const roster = rosterOf(mess);
	const duties = dutiesFor(roster, m);
	const meals: Ledger["meals"] = [];
	const expenses: Expense[] = [];

	for (let d = 1; d <= recordedDays(m); d++) {
		const date = day(m, d);
		roster.forEach((p, who) => {
			if (!isHome(p, date)) return;
			const meal = mealsFor(p.habit);
			if (meal.lunch + meal.dinner > 0) meals.push({ who, date, ...meal });
		});
		if (d % 3 !== 1) continue;
		const duty = duties.find((x) => x.startDate <= date && date <= x.endDate);
		const headcount = roster.filter((p) => isHome(p, date)).length;
		expenses.push({
			type: "GROCERY",
			amount: round10(((1150 + random() * 650) * headcount) / 5),
			splitMethod: "EQUAL",
			description: pick(GROCERIES),
			spentAt: date,
			paidBy: duty && roster[duty.who]!.buysGrocery ? duty.who : null,
		});
	}
	if (m !== OPEN) expenses.push(...sharedBills(mess, m));

	const deposits = roster.flatMap((p, who) => {
		// The 2nd of the month, or the day they moved in.
		const first = joinedOf(p) > day(m, 2) ? joinedOf(p) : day(m, 2);
		if (!billedIn(p, m) || !isMember(p, first)) return [];
		const amounts = p.deposits?.(m) ?? [2500];
		return (m === OPEN ? amounts.slice(0, 1) : amounts).map((amount, k) => ({
			who,
			amount,
			at: at(addDays(first, k * 10), 20),
			note: amounts.length > 1 ? `Instalment ${k + 1} of ${amounts.length}` : null,
		}));
	});

	return { meals, expenses, deposits, duties };
};

const payPlan = (p: Person, m: number): Pay =>
	m === LAST_CLOSED ? (p.lastBill ?? "full") : "full";

const payAmount = (pay: Pay, due: number) =>
	due <= 0 || pay === "none" ? 0 : pay === "half" ? Math.round(due / 2) : due;

// ---------- the plan, without a database ----------

// Mirrors cycle.service's loadSettlement, so the dry run predicts the bills.
const daysPresent = (p: Person, m: number) => {
	const from = Math.max(joinedOf(p).getTime(), day(m, 1).getTime());
	const to = Math.min(p.left?.getTime() ?? Infinity, day(m, daysIn(m)).getTime());
	return to < from ? 0 : Math.floor((to - from) / DAY_MS) + 1;
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const simulate = (mess: MessSpec, ledgers: Ledger[]) => {
	const roster = rosterOf(mess);
	let opening = new Map<number, number>();
	let rows: string[][] = [];

	for (let m = 0; m <= LAST_CLOSED; m++) {
		const { meals, expenses, deposits } = ledgers[m]!;
		const billed = roster.flatMap((p, i) => (billedIn(p, m) ? [i] : []));
		const result = computeSettlement({
			monthlyRent: mess.monthlyRent,
			monthlyDeposit: 0,
			daysInMonth: daysIn(m),
			expenses,
			members: billed.map((who) => ({
				memberId: String(who),
				mealCount: sum(meals.filter((x) => x.who === who).map((x) => x.lunch + x.dinner)),
				depositTotal: sum(deposits.filter((x) => x.who === who).map((x) => x.amount)),
				paidExpenseTotal: sum(expenses.filter((x) => x.paidBy === who).map((x) => x.amount)),
				openingBalance: opening.get(who) ?? 0,
				daysPresent: daysPresent(roster[who]!, m),
			})),
		});

		opening = new Map();
		rows = result.bills.map((bill) => {
			const p = roster[Number(bill.memberId)]!;
			const paid = payAmount(payPlan(p, m), bill.dueAmount);
			opening.set(Number(bill.memberId), bill.dueAmount - paid);
			return [
				p.name,
				String(bill.mealCount),
				bill.openingBalance.toFixed(2),
				bill.totalPayable.toFixed(2),
				bill.creditAmount.toFixed(2),
				bill.dueAmount.toFixed(2),
				paid.toFixed(2),
				p.story,
			];
		});
		if (m === LAST_CLOSED)
			console.log(`  ${MONTHS[m]!.month}/${MONTHS[m]!.year} meal rate ${result.mealRate}`);
	}

	console.table(
		rows.map(([name, meals, opening, payable, credit, due, paid, story]) => ({
			name,
			meals,
			opening,
			payable,
			credit,
			due,
			paid,
			story,
		})),
	);
};

// ---------- writing ----------

type Row = { id: string; name: string; email: string; role: Role };
const actor = (u: Row): RequestUser => ({
	userId: u.id,
	name: u.name,
	email: u.email,
	role: u.role,
});

const findUser = async (email: string) => {
	const user = await prisma.user.findUnique({
		where: { email },
		select: { id: true, name: true, email: true, role: true },
	});
	if (!user) throw new Error(`${email} is missing. Start the API once to seed it.`);
	return user;
};

// The demo manager's mess and every @messmate.test account, so a rerun resets.
const findOld = async (demoManagerId: string) => {
	const users = await prisma.user.findMany({
		where: { email: { endsWith: `@${DOMAIN}` } },
		select: { id: true },
	});
	const messes = await prisma.mess.findMany({
		where: { managerId: { in: [demoManagerId, ...users.map((u) => u.id)] } },
		select: {
			id: true,
			name: true,
			_count: { select: { members: true, cycles: true } },
		},
	});
	return { userIds: users.map((u) => u.id), messes };
};

const wipe = async ({ userIds, messes }: Awaited<ReturnType<typeof findOld>>) => {
	const messIds = messes.map((m) => m.id);
	// A payment stops its member being deleted (onDelete Restrict), so it goes first.
	await prisma.payment.deleteMany({ where: { member: { messId: { in: messIds } } } });
	await prisma.mess.deleteMany({ where: { id: { in: messIds } } });
	await prisma.auditLog.deleteMany({ where: { entity: "User", entityId: { in: userIds } } });
	await prisma.user.deleteMany({ where: { id: { in: userIds } } });
};

const createUser = (
	p: { name: string; email: string },
	role: Role,
	password: string,
	createdAt: Date,
) =>
	prisma.user.create({
		data: {
			name: p.name,
			email: p.email,
			password,
			role,
			emailVerified: true,
			createdAt,
			updatedAt: createdAt,
		},
		select: { id: true, name: true, email: true, role: true },
	});

const approveManager = async (
	user: Row,
	mess: MessSpec,
	admin: Row,
) => {
	const reviewedAt = addDays(FOUNDED, -1);
	await prisma.managerApplication.create({
		data: {
			userId: user.id,
			messName: mess.name,
			messAddress: mess.address,
			status: ManagerApplicationStatus.APPROVED,
			reviewedBy: admin.id,
			reviewedAt,
			createdAt: addDays(FOUNDED, -3),
		},
	});
	await prisma.auditLog.create({
		data: {
			actorId: admin.id,
			action: AuditAction.MANAGER_APPROVED,
			entity: "User",
			entityId: user.id,
			before: { status: ManagerApplicationStatus.PENDING, role: Role.MEMBER },
			after: {
				status: ManagerApplicationStatus.APPROVED,
				role: Role.MESS_MANAGER,
				messName: mess.name,
				rejectionReason: null,
			},
			createdAt: reviewedAt,
		},
	});
};

const DEFAULTS: Record<Habit, [number, number]> = {
	regular: [1, 1],
	half: [0.5, 1],
	lunchOnly: [1, 0],
};

// Joined the way the app joins people: an invitation or a request, answered.
const join = async (messId: string, p: Person, user: Row, manager: Row) => {
	const joinedAt = at(joinedOf(p), 10);
	const via = p.via ?? MembershipRequestKind.INVITE;
	const [defaultLunch, defaultDinner] = DEFAULTS[p.habit ?? "regular"];
	const member = await prisma.messMember.create({
		data: {
			messId,
			userId: user.id,
			joinedAt,
			defaultLunch,
			defaultDinner,
			...(p.left && { status: MemberStatus.LEFT, leftAt: at(p.left, 20) }),
		},
		select: { id: true },
	});
	const asker = via === MembershipRequestKind.REQUEST ? user : manager;
	const answerer = via === MembershipRequestKind.REQUEST ? manager : user;
	await prisma.membershipRequest.create({
		data: {
			messId,
			userId: user.id,
			kind: via,
			status: MembershipRequestStatus.ACCEPTED,
			createdById: asker.id,
			decidedById: answerer.id,
			decidedAt: joinedAt,
			createdAt: addDays(joinedAt, -1),
		},
	});
	const audits = [
		{
			actorId: answerer.id,
			action: AuditAction.MEMBER_JOINED,
			before: { status: null },
			after: { status: MemberStatus.ACTIVE, via },
			createdAt: joinedAt,
		},
		...(p.left
			? [
					{
						actorId: user.id,
						action: AuditAction.MEMBER_LEFT,
						before: { status: MemberStatus.ACTIVE },
						after: { status: MemberStatus.LEFT },
						createdAt: at(p.left, 20),
					},
				]
			: []),
	];
	await prisma.auditLog.createMany({
		data: audits.map((a) => ({
			...a,
			messId,
			subjectMemberId: member.id,
			entity: "MessMember",
			entityId: member.id,
		})),
	});
	return member.id;
};

const insertLedger = async (
	cycleId: string,
	ledger: Ledger,
	ids: string[],
	manager: Row,
) => {
	await prisma.mealEntry.createMany({
		data: ledger.meals.map((x) => ({
			cycleId,
			memberId: ids[x.who]!,
			date: x.date,
			lunch: x.lunch,
			dinner: x.dinner,
			createdAt: at(x.date, 22),
			updatedAt: at(x.date, 22),
		})),
	});
	await prisma.expense.createMany({
		data: ledger.expenses.map((x) => ({
			cycleId,
			type: x.type,
			amount: x.amount,
			splitMethod: x.splitMethod,
			description: x.description,
			spentAt: x.spentAt,
			paidByMemberId: x.paidBy === null ? null : ids[x.paidBy]!,
			createdById: manager.id,
			createdAt: at(x.spentAt, 19),
			updatedAt: at(x.spentAt, 19),
		})),
	});
	await prisma.deposit.createMany({
		data: ledger.deposits.map((x) => ({
			cycleId,
			memberId: ids[x.who]!,
			amount: x.amount,
			note: x.note,
			createdById: manager.id,
			createdAt: x.at,
			updatedAt: x.at,
		})),
	});
	await prisma.groceryDuty.createMany({
		data: ledger.duties.map((x) => ({
			cycleId,
			memberId: ids[x.who]!,
			startDate: x.startDate,
			endDate: x.endDate,
		})),
	});
};

// Close through the service, then move the dates back to the 1st of next month.
const closeMonth = async (cycleId: string, m: number, manager: Row) => {
	await CycleServices.closeCycle(cycleId, actor(manager));
	const closedAt = past(at(day(m + 1, 1), 21));
	await prisma.billingCycle.update({ where: { id: cycleId }, data: { closedAt } });
	await prisma.memberBill.updateMany({ where: { cycleId }, data: { createdAt: closedAt } });
	await prisma.auditLog.updateMany({
		where: { entityId: cycleId, action: AuditAction.CYCLE_CLOSED },
		data: { createdAt: closedAt },
	});
	return closedAt;
};

const payMonth = async (
	cycleId: string,
	m: number,
	roster: Person[],
	ids: string[],
	manager: Row,
	closedAt: Date,
) => {
	const bills = await prisma.memberBill.findMany({
		where: { cycleId },
		select: { id: true, memberId: true, dueAmount: true },
	});
	let k = 0;
	for (const bill of bills) {
		const p = roster[ids.indexOf(bill.memberId)]!;
		const amount = payAmount(payPlan(p, m), Number(bill.dueAmount));
		if (amount === 0) continue;
		const payment = await PaymentServices.recordCashPayment(
			{ billId: bill.id, amount, note: "Cash to the manager" },
			actor(manager),
		);
		const paidAt = past(new Date(closedAt.getTime() + ++k * 5 * 3_600_000));
		await prisma.payment.update({
			where: { id: payment.id },
			data: { paidAt, createdAt: paidAt, updatedAt: paidAt },
		});
		await prisma.auditLog.updateMany({
			where: { entityId: payment.id, action: AuditAction.PAYMENT_SETTLED },
			data: { createdAt: paidAt },
		});
	}
};

// This month runs through the services, so the activity feed has today in it.
const runOpenMonth = async (
	messId: string,
	ledger: Ledger,
	ids: string[],
	manager: Row,
) => {
	const by = actor(manager);
	const { year, month } = MONTHS[OPEN]!;
	const cycle = await CycleServices.openCycle({ messId, year, month }, by);
	await prisma.billingCycle.update({
		where: { id: cycle.id },
		data: { createdAt: past(at(day(OPEN, 1), 9)) },
	});
	for (const x of ledger.duties)
		await GroceryDutyServices.assignDuty(
			{ cycleId: cycle.id, memberId: ids[x.who]!, startDate: x.startDate, endDate: x.endDate },
			by,
		);
	for (const x of ledger.deposits)
		await DepositServices.addDeposit(
			{ cycleId: cycle.id, memberId: ids[x.who]!, amount: x.amount, note: x.note ?? undefined },
			by,
		);
	for (const x of ledger.expenses)
		await ExpenseServices.addExpense(
			{
				cycleId: cycle.id,
				type: x.type,
				amount: x.amount,
				splitMethod: x.splitMethod,
				description: x.description,
				spentAt: x.spentAt,
				paidByMemberId: x.paidBy === null ? undefined : ids[x.paidBy]!,
			},
			undefined,
			by,
		);
	for (let d = 1; d <= recordedDays(OPEN); d++) {
		const entries = ledger.meals
			.filter((x) => x.date.getTime() === day(OPEN, d).getTime())
			.map((x) => ({ memberId: ids[x.who]!, lunch: x.lunch, dinner: x.dinner }));
		if (entries.length)
			await MealServices.addDailyMeals({ cycleId: cycle.id, date: day(OPEN, d), entries }, by);
	}
	return cycle.id;
};

const writeMess = async (
	mess: MessSpec,
	ledgers: Ledger[],
	users: Map<string, Row>,
	admin: Row,
) => {
	const roster = rosterOf(mess);
	const manager = users.get(mess.manager.email)!;
	if (mess.manager.email.endsWith(DOMAIN)) await approveManager(manager, mess, admin);

	const created = await prisma.mess.create({
		data: {
			name: mess.name,
			address: mess.address,
			monthlyRent: mess.monthlyRent,
			managerId: manager.id,
			createdAt: at(FOUNDED, 11),
			members: {
				create: {
					userId: manager.id,
					joinedAt: at(FOUNDED, 11),
					defaultLunch: 1,
					defaultDinner: 1,
				},
			},
		},
		select: { id: true, joinCode: true, members: { select: { id: true } } },
	});
	const ids: string[] = [created.members[0]!.id];
	const joinUpTo = async (end: Date) => {
		for (const [i, p] of roster.entries())
			if (i > 0 && !ids[i] && joinedOf(p) <= end)
				ids[i] = await join(created.id, p, users.get(p.email)!, manager);
	};

	for (let m = 0; m <= LAST_CLOSED; m++) {
		// People join when they joined, so an older month never bills them.
		await joinUpTo(day(m, daysIn(m)));
		const cycle = await prisma.billingCycle.create({
			data: {
				messId: created.id,
				year: MONTHS[m]!.year,
				month: MONTHS[m]!.month,
				createdAt: at(day(m, 1), 9),
			},
			select: { id: true },
		});
		await insertLedger(cycle.id, ledgers[m]!, ids, manager);
		const closedAt = await closeMonth(cycle.id, m, manager);
		await payMonth(cycle.id, m, roster, ids, manager, closedAt);
	}
	await joinUpTo(TODAY);
	const openCycleId = await runOpenMonth(created.id, ledgers[OPEN]!, ids, manager);
	return { id: created.id, joinCode: created.joinCode, ids, openCycleId, manager };
};

const FINANCE: Record<
	"tutor" | "job",
	[FinanceEntryType, FinanceCategory, number, number, string][]
> = {
	tutor: [
		["INCOME", "FAMILY", 8000, 1, "Sent from home"],
		["INCOME", "TUITION", 5000, 7, "Tuition, class 9 maths"],
	],
	job: [["INCOME", "SALARY", 12000, 5, "Part-time job, call centre"]],
};

const financeFor = (kind: "tutor" | "job", m: number) => {
	const rows: [FinanceEntryType, FinanceCategory, number, number, string][] = [
		...FINANCE[kind],
		["EXPENSE", "MESS", round10(5600 + random() * 1200), 4, "Mess bill"],
		["EXPENSE", "MOBILE_INTERNET", 499, 2, "Mobile data pack"],
		["EXPENSE", "EDUCATION", round10(300 + random() * 1200), 14, "Books and photocopies"],
		["EXPENSE", "TRANSPORT", round10(150 + random() * 300), 9, "Bus and rickshaw"],
		["EXPENSE", "TRANSPORT", round10(150 + random() * 300), 21, "Bus and rickshaw"],
		["EXPENSE", "FOOD", round10(200 + random() * 400), 11, "Tea and snacks"],
		["EXPENSE", "FOOD", round10(200 + random() * 400), 24, "Eating out with friends"],
		["EXPENSE", "HEALTH", 350, 17, "Medicine"],
		["EXPENSE", "SHOPPING", round10(800 + random() * 1500), 26, "Clothes"],
	];
	return rows
		.filter(([, , , d]) => d <= daysIn(m) && day(m, d) <= TODAY)
		.map(([type, category, amount, d, note]) => ({
			type,
			category,
			amount,
			date: day(m, d),
			note,
			createdAt: past(at(day(m, d), 21)),
		}));
};

const write = async (ledgers: Ledger[][], admin: Row) => {
	// The services mail bills and receipts; the demo needs none of it.
	transporter.sendMail = (async () => ({})) as unknown as typeof transporter.sendMail;

	const managerPassword = await bcrypt.hash(config.demo_manager_password, Number(config.bcrypt_salt_rounds));
	const memberPassword = await bcrypt.hash(config.demo_member_password, Number(config.bcrypt_salt_rounds));

	const users = new Map<string, Row>();
	for (const mess of MESSES)
		for (const [i, p] of rosterOf(mess).entries())
			users.set(
				p.email,
				p.email.endsWith(DOMAIN)
					? await createUser(
							p,
							i === 0 ? Role.MESS_MANAGER : Role.MEMBER,
							i === 0 ? managerPassword : memberPassword,
							addDays(joinedOf(p), -4),
						)
					: await findUser(p.email),
			);

	const written = [];
	for (const [n, mess] of MESSES.entries())
		written.push(await writeMess(mess, ledgers[n]!, users, admin));

	// The demo member skips lunch the day after tomorrow, and the day after.
	const [first] = written;
	const demo = users.get(config.demo_member_email)!;
	const planDays = [2, 3]
		.map((n) => addDays(TODAY, n))
		.filter((d) => d.getUTCMonth() + 1 === MONTHS[OPEN]!.month);
	if (planDays.length)
		await MealPlanServices.setMealPlan(
			{
				cycleId: first!.openCycleId,
				days: planDays.map((date, k) => ({ date, lunch: 0, dinner: k === 0 ? 1 : 0 })),
			},
			actor(demo),
		);

	for (const mess of MESSES)
		for (const p of mess.members)
			if (p.finance)
				await prisma.financeEntry.createMany({
					data: MONTHS.flatMap((_, m) => financeFor(p.finance!, m)).map((x) => ({
						...x,
						userId: users.get(p.email)!.id,
						updatedAt: x.createdAt,
					})),
				});

	// The Postman collection's own pair. Neither lives in a mess, so a run opens
	// one, works in it and deletes it, and never touches the demo messes.
	await createUser(POSTMAN_MANAGER, Role.MESS_MANAGER, managerPassword, addDays(TODAY, -1));
	await createUser(POSTMAN_MEMBER, Role.MEMBER, memberPassword, addDays(TODAY, -1));

	// Waiting on someone: a request, an invitation and a manager application.
	const asker = await createUser(ASKER, Role.MEMBER, memberPassword, addDays(TODAY, -2));
	const invitee = await createUser(INVITEE, Role.MEMBER, memberPassword, addDays(TODAY, -3));
	const applicant = await createUser(APPLICANT, Role.MEMBER, memberPassword, addDays(TODAY, -1));
	await prisma.membershipRequest.createMany({
		data: [
			{
				messId: first!.id,
				userId: asker.id,
				kind: MembershipRequestKind.REQUEST,
				note: ASKER.note,
				createdById: asker.id,
				createdAt: past(at(addDays(TODAY, -1), 21)),
			},
			{
				messId: first!.id,
				userId: invitee.id,
				kind: MembershipRequestKind.INVITE,
				createdById: first!.manager.id,
				createdAt: past(at(addDays(TODAY, -1), 11)),
			},
		],
	});
	await prisma.managerApplication.create({
		data: {
			userId: applicant.id,
			messName: APPLICANT.messName,
			messAddress: APPLICANT.messAddress,
			createdAt: past(at(TODAY, 9)),
		},
	});

	await invalidateCache(cacheKeys.dashboardStats);
	await invalidateCache(cacheKeys.dashboardTrends);
	return written;
};

const report = async (written: Awaited<ReturnType<typeof write>>) => {
	const { year, month } = MONTHS[LAST_CLOSED]!;
	for (const [n, mess] of MESSES.entries()) {
		const bills = await prisma.memberBill.findMany({
			where: { cycle: { messId: written[n]!.id, year, month } },
			select: {
				status: true,
				totalPayable: true,
				dueAmount: true,
				member: { select: { user: { select: { name: true, email: true } } } },
			},
		});
		const carried = await prisma.memberBill.count({
			where: { cycle: { messId: written[n]!.id }, status: "CARRIED" },
		});
		console.log(
			`\n${mess.name}  join code ${written[n]!.joinCode}, ${carried} bill(s) carried forward`,
		);
		console.table(
			bills.map((b) => ({
				name: b.member.user.name,
				email: b.member.user.email,
				payable: Number(b.totalPayable),
				due: Number(b.dueAmount),
				status: b.status,
			})),
		);
	}
};

const main = async () => {
	const admin = await findUser(config.super_admin_email);
	const demoManager = await findUser(config.demo_manager_email);
	const demoMember = await findUser(config.demo_member_email);

	const ledgers = MESSES.map((mess) => MONTHS.map((_, m) => ledgerFor(mess, m)));
	const old = await findOld(demoManager.id);

	console.log(`Months: ${MONTHS.map((x) => `${x.month}/${x.year}`).join(", ")} (last one open)`);
	console.log(`Deletes ${old.userIds.length} @${DOMAIN} accounts and these messes:`);
	console.table(old.messes.map((m) => ({ name: m.name, ...m._count })));
	// Anywhere else the demo member lives stays, next to the new mess.
	const elsewhere = await prisma.messMember.findMany({
		where: {
			userId: demoMember.id,
			status: MemberStatus.ACTIVE,
			messId: { notIn: old.messes.map((m) => m.id) },
		},
		select: { mess: { select: { name: true } } },
	});
	console.log(`Demo member also in: ${elsewhere.map((x) => x.mess.name).join(", ") || "nothing"}`);

	if (!WRITE) {
		for (const [n, mess] of MESSES.entries()) {
			console.log(`\n${mess.name}`);
			simulate(mess, ledgers[n]!);
		}
		console.log("\nDry run: nothing written. Add --write to replace the demo data.");
		return;
	}

	await wipe(old);
	await report(await write(ledgers, admin));
	console.log(`\nEvery @${DOMAIN} account uses the demo member's password (managers: the demo manager's).`);
};

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
		if (redisClient.isOpen) await redisClient.quit();
	});
