import { Router } from "express";
import { cronAuth } from "../../middleware/cronAuth";
import { CronController } from "./cron.controller";

const router = Router();

router.get("/meal-plan-reminder", cronAuth, CronController.mealPlanReminder);

router.get(
	"/unpaid-bill-reminder",
	cronAuth,
	CronController.unpaidBillReminder,
);

export const CronRoutes = router;
