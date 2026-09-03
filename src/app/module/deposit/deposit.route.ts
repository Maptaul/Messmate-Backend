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
