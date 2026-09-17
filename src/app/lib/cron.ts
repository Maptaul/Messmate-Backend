import cron from "node-cron";
import { CronServices } from "../module/cron/cron.service";

const DHAKA_TIMEZONE = "Asia/Dhaka";

const run = async (name: string, job: () => Promise<unknown>) => {
	try {
		const result = await job();

		console.log(`Cron: ${name} finished`, result);
	} catch (error) {
		console.error(`[cron][${name}]`, error);
	}
};

export const startMessMateCrons = () => {
	cron.schedule(
		"0 22 * * *",
		() =>
			run("meal-plan-reminder", () =>
				CronServices.sendMealPlanReminders(false),
			),
		{ timezone: DHAKA_TIMEZONE },
	);

	cron.schedule(
		"5 23 * * *",
		() => run("meal-headcount", () => CronServices.sendMealHeadcounts(false)),
		{ timezone: DHAKA_TIMEZONE },
	);

	cron.schedule(
		"0 10 * * 1",
		() =>
			run("unpaid-bill-reminder", () =>
				CronServices.sendUnpaidBillReminders(false),
			),
		{ timezone: DHAKA_TIMEZONE },
	);

	console.log(
		`Cron: schedules started (${DHAKA_TIMEZONE}) - meal-plan-reminder 22:00 daily, meal-headcount 23:05 daily, unpaid-bill-reminder 10:00 Mondays`,
	);
};
