import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "./AppError";

type TSeedUser = {
	name: string;
	email: string;
	password: string;
	role: Role;
	label: string;
};

const seedUser = async ({ name, email, password, role, label }: TSeedUser) => {
	const existing = await prisma.user.findUnique({ where: { email } });

	if (existing) {
		console.log(`${label} Already Exists!`);
		return existing;
	}

	if (!name || !email || !password) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			`${label} Name, Email Or Password Missing In Env File!!!`,
		);
	}

	const hashedPassword = await bcrypt.hash(
		password,
		Number(config.bcrypt_salt_rounds),
	);

	const user = await prisma.user.create({
		// Seeded accounts skip the OTP round trip: there is no inbox to check
		// during a fresh deploy, and the evaluator needs to log in immediately.
		data: { name, email, password: hashedPassword, role, emailVerified: true },
	});

	console.log(`${label} Created: ${email}`);

	return user;
};

export const seedSuperAdmin = async () =>
	seedUser({
		name: config.super_admin_name,
		email: config.super_admin_email,
		password: config.super_admin_password,
		role: Role.ADMIN,
		label: "Super Admin",
	});

export const seedDemoManager = async () =>
	seedUser({
		name: config.demo_manager_name,
		email: config.demo_manager_email,
		password: config.demo_manager_password,
		role: Role.MESS_MANAGER,
		label: "Demo Manager",
	});

export const seedDemoMember = async () =>
	seedUser({
		name: config.demo_member_name,
		email: config.demo_member_email,
		password: config.demo_member_password,
		role: Role.MEMBER,
		label: "Demo Member",
	});
