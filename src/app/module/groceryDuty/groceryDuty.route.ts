import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { GroceryDutyController } from "./groceryDuty.controller";
import { GroceryDutyValidation } from "./groceryDuty.validation";

const router = Router();

router.post(
	"/assign-duty",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(GroceryDutyValidation.AssignDutyValidationZodSchema),
	GroceryDutyController.assignDuty,
);

router.get(
	"/cycle-duties/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	GroceryDutyController.getCycleDuties,
);

router.get(
	"/cycle-calendar/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	GroceryDutyController.getCycleCalendar,
);

router.get(
	"/my-duty-days/:cycleId",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	GroceryDutyController.getMyDutyDays,
);

router.patch(
	"/update-duty/:dutyId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(GroceryDutyValidation.UpdateDutyValidationZodSchema),
	GroceryDutyController.updateDuty,
);

router.delete(
	"/remove-duty/:dutyId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	GroceryDutyController.removeDuty,
);

export const GroceryDutyRoutes = router;
