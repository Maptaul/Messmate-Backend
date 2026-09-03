import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { MealPlanController } from "./mealPlan.controller";
import { MealPlanValidation } from "./mealPlan.validation";

const router = Router();

// A member plans for themselves; a manager may plan for anyone in their mess.
router.post(
	"/set-my-plan",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(MealPlanValidation.SetMealPlanValidationZodSchema),
	MealPlanController.setMealPlan,
);

router.get(
	"/my-calendar/:cycleId",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	MealPlanController.getMyCalendar,
);

// Open to members: whoever is on grocery duty needs the headcount, and the
// duty rotates through the whole mess.
router.get(
	"/cycle-calendar/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MealPlanController.getCycleCalendar,
);

router.post(
	"/apply-to-register",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(MealPlanValidation.ApplyPlanValidationZodSchema),
	MealPlanController.applyPlanToRegister,
);

export const MealPlanRoutes = router;
