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

// Render assigns the port and expects the process to bind to exactly it. The
// fallback is only for running locally without a PORT in .env - with neither,
// Express would quietly pick a random free port and nothing would answer.
const PORT = config.port ?? 5000;

const main = async () => {
	try {
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		// Redis is not optional: the bKash token cache lives in it. The rate
		// limiter's store may have opened it already while `./app` was imported,
		// which is why this goes through ensureRedis rather than connect().
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
