import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { MealController } from "./meal.controller";
import { MealValidation } from "./meal.validation";

const router = Router();

router.post(
	"/add-daily-meals",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(MealValidation.AddDailyMealsValidationZodSchema),
	MealController.addDailyMeals,
);

router.get(
	"/cycle-meals/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MealController.getCycleMeals,
);

router.get(
	"/meal-summary/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MealController.getMealSummary,
);

router.patch(
	"/update-meal/:mealId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(MealValidation.UpdateMealValidationZodSchema),
	MealController.updateMeal,
);

router.delete(
	"/delete-meal/:mealId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	MealController.deleteMeal,
);

export const MealRoutes = router;
