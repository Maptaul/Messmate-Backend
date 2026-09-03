import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { CycleController } from "./cycle.controller";
import { CycleValidation } from "./cycle.validation";

const router = Router();

router.post(
	"/open-cycle",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(CycleValidation.OpenCycleValidationZodSchema),
	CycleController.openCycle,
);

router.get(
	"/mess-cycles/:messId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	CycleController.getMessCycles,
);

router.post(
	"/close-cycle/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	CycleController.closeCycle,
);

router.post(
	"/reopen-cycle/:cycleId",
	auth(Role.ADMIN),
	CycleController.reopenCycle,
);

router.get(
	"/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	CycleController.getSingleCycle,
);

export const CycleRoutes = router;
