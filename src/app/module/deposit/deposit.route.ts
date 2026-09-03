import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { DepositController } from "./deposit.controller";
import { DepositValidation } from "./deposit.validation";

const router = Router();

router.post(
	"/add-deposit",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(DepositValidation.AddDepositValidationZodSchema),
	DepositController.addDeposit,
);

// Readable by everyone in the mess - a deposit is credit against someone's
// bill, so being able to check it is what lets a member confirm the cash
// they handed over actually got recorded.
router.get(
	"/cycle-deposits/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	DepositController.getCycleDeposits,
);

router.patch(
	"/update-deposit/:depositId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(DepositValidation.UpdateDepositValidationZodSchema),
	DepositController.updateDeposit,
);

router.delete(
	"/delete-deposit/:depositId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	DepositController.deleteDeposit,
);

export const DepositRoutes = router;
