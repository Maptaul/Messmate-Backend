import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { GroceryDutyController } from "./groceryDuty.controller";
import { GroceryDutyValidation } from "./groceryDuty.validation";

const router = Router();

// Only the manager decides who shops - the same split as recording meals or
// expenses. They can put themselves on the rota, but assigning it is
// management, not membership.
router.post(
	"/assign-duty",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(GroceryDutyValidation.AssignDutyValidationZodSchema),
	GroceryDutyController.assignDuty,
);

// Readable by the whole mess - this is the rota on the wall.
router.get(
	"/cycle-duties/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	GroceryDutyController.getCycleDuties,
);

// The same bookings, expanded to one row per calendar day.
router.get(
	"/cycle-calendar/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	GroceryDutyController.getCycleCalendar,
);

// A manager has a membership too, so this works for them on their own mess.
// Only an admin, who lives in no mess, gets nothing here.
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
