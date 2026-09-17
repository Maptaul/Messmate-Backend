import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { FinanceController } from "./finance.controller";
import { FinanceValidation } from "./finance.validation";

const router = Router();

router.get(
	"/categories",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	FinanceController.getCategories,
);

router.post(
	"/add-entry",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(FinanceValidation.AddFinanceEntryValidationZodSchema),
	FinanceController.addEntry,
);

router.get(
	"/my-entries",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	FinanceController.getMyEntries,
);

router.get(
	"/summary",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	FinanceController.getSummary,
);

router.patch(
	"/update-entry/:entryId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(FinanceValidation.UpdateFinanceEntryValidationZodSchema),
	FinanceController.updateEntry,
);

router.delete(
	"/delete-entry/:entryId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	FinanceController.deleteEntry,
);

export const FinanceRoutes = router;
