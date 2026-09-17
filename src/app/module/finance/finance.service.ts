import httpStatus from "http-status";
import {
	FinanceCategory,
	FinanceEntryType,
} from "../../../generated/prisma/enums";
import type { FinanceEntryWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { dhakaDateOnly } from "../cron/cron.service";
import {
	categoryFits,
	FINANCE_CATEGORIES,
	FINANCE_PERIODS,
	type TFinancePeriod,
} from "./finance.constant";
import type {
	IAddFinanceEntryPayload,
	IUpdateFinanceEntryPayload,
} from "./finance.interface";
import { buildSummary, periodRange } from "./finance.summary";

const entrySelect = {
	id: true,
	type: true,
	category: true,
	amount: true,
	date: true,
	note: true,
	createdAt: true,
	updatedAt: true,
};

const toDateOnly = (date: Date) =>
	new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);

const parseDay = (value: string, field: string) => {
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`${field} Must Be A Date Like 2026-09-18`,
		);
	}

	return toDateOnly(date);
};

const entryDay = (date?: Date) => {
	const today = dhakaDateOnly(new Date());

	if (!date) {
		return today;
	}

	const day = toDateOnly(date);

	if (day > today) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"An Entry Cannot Be Dated In The Future",
		);
	}

	return day;
};

const assertCategoryFits = (
	type: FinanceEntryType,
	category: FinanceCategory,
) => {
	if (!categoryFits(type, category)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`${category} Is Not A Category For ${type}`,
		);
	}
};

const findOwnEntry = async (entryId: string, user: RequestUser) => {
	const entry = await prisma.financeEntry.findFirst({
		where: { id: entryId, userId: user.userId, isDeleted: false },
		select: { id: true, type: true, category: true },
	});

	// Someone else's entry answers exactly like a missing one.
	if (!entry) {
		throw new AppError(httpStatus.NOT_FOUND, "Entry Not Found");
	}

	return entry;
};

const getCategories = () => FINANCE_CATEGORIES;

const addEntry = async (
	payload: IAddFinanceEntryPayload,
	user: RequestUser,
) => {
	assertCategoryFits(payload.type, payload.category);

	return prisma.financeEntry.create({
		data: {
			userId: user.userId,
			type: payload.type,
			category: payload.category,
			amount: payload.amount,
			date: entryDay(payload.date),
			note: payload.note || null,
		},
		select: entrySelect,
	});
};

const getMyEntries = async (query: IQuery, user: RequestUser) => {
	const rawLimit = Math.floor(Number(query.limit)) || 10;
	const limit = Math.min(Math.max(rawLimit, 1), 100);
	const page = Math.max(Math.floor(Number(query.page)) || 1, 1);
	const skip = (page - 1) * limit;
	const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

	const andConditions: FinanceEntryWhereInput[] = [
		{ userId: user.userId, isDeleted: false },
	];

	if (query.type) {
		if (!Object.values(FinanceEntryType).includes(query.type)) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Type Must Be INCOME Or EXPENSE",
			);
		}

		andConditions.push({ type: query.type });
	}

	if (query.category) {
		if (!Object.values(FinanceCategory).includes(query.category)) {
			throw new AppError(httpStatus.BAD_REQUEST, "Invalid Category");
		}

		andConditions.push({ category: query.category });
	}

	if (query.from) {
		andConditions.push({ date: { gte: parseDay(query.from, "from") } });
	}

	if (query.to) {
		andConditions.push({ date: { lte: parseDay(query.to, "to") } });
	}

	if (query.searchTerm) {
		andConditions.push({
			note: { contains: query.searchTerm, mode: "insensitive" },
		});
	}

	const where: FinanceEntryWhereInput = { AND: andConditions };

	const [entries, total] = await Promise.all([
		prisma.financeEntry.findMany({
			where,
			take: limit,
			skip,
			orderBy: [{ date: sortOrder }, { createdAt: sortOrder }],
			select: entrySelect,
		}),
		prisma.financeEntry.count({ where }),
	]);

	return {
		data: entries,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

const getSummary = async (query: IQuery, user: RequestUser) => {
	const period = (query.period ?? "monthly") as TFinancePeriod;

	if (!FINANCE_PERIODS.includes(period)) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Period Must Be daily, weekly, monthly Or yearly",
		);
	}

	const anchor = query.date
		? parseDay(query.date, "date")
		: dhakaDateOnly(new Date());

	const range = periodRange(period, anchor);

	const rows = await prisma.financeEntry.groupBy({
		by: ["date", "type", "category"],
		where: {
			userId: user.userId,
			isDeleted: false,
			date: { gte: range.from, lte: range.to },
		},
		_sum: { amount: true },
	});

	return buildSummary(
		period,
		range,
		rows.map((row) => ({
			date: row.date,
			type: row.type,
			category: row.category,
			amount: Number(row._sum.amount ?? 0),
		})),
	);
};

const updateEntry = async (
	entryId: string,
	payload: IUpdateFinanceEntryPayload,
	user: RequestUser,
) => {
	const entry = await findOwnEntry(entryId, user);

	assertCategoryFits(
		payload.type ?? entry.type,
		payload.category ?? entry.category,
	);

	return prisma.financeEntry.update({
		where: { id: entry.id },
		data: {
			type: payload.type,
			category: payload.category,
			amount: payload.amount,
			date: payload.date ? entryDay(payload.date) : undefined,
			note: payload.note === undefined ? undefined : payload.note || null,
		},
		select: entrySelect,
	});
};

const deleteEntry = async (entryId: string, user: RequestUser) => {
	const entry = await findOwnEntry(entryId, user);

	return prisma.financeEntry.update({
		where: { id: entry.id },
		data: { isDeleted: true, deletedAt: new Date() },
		select: { id: true, isDeleted: true, deletedAt: true },
	});
};

export const FinanceServices = {
	getCategories,
	addEntry,
	getMyEntries,
	getSummary,
	updateEntry,
	deleteEntry,
};
