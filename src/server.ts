import app from "./app";
import config from "./app/config";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { ensureRedis } from "./app/lib/redis";
import {
	seedDemoManager,
	seedDemoMember,
	seedSuperAdmin,
} from "./app/utils/seed";

const PORT = config.port ?? 5000;

const main = async () => {
	try {
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		await ensureRedis();
		console.log("Redis Connected Successfully.");
		await transporter.verify();
		console.log("Nodemailer Connected successfully.");

		await seedSuperAdmin();
		await seedDemoManager();
		await seedDemoMember();

		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
