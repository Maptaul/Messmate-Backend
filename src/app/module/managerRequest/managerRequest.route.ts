import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ManagerRequestController } from "./managerRequest.controller";
import { ManagerRequestValidation } from "./managerRequest.validation";

const router = Router();

router.post(
	"/apply",
	auth(Role.MEMBER),
	validateRequest(ManagerRequestValidation.ApplyForManagerValidationZodSchema),
	ManagerRequestController.applyForManager,
);

router.get(
	"/all-requests",
	auth(Role.ADMIN),
	ManagerRequestController.getAllRequests,
);

router.post(
	"/review",
	auth(Role.ADMIN),
	validateRequest(
		ManagerRequestValidation.ReviewManagerRequestValidationZodSchema,
	),
	ManagerRequestController.reviewRequest,
);

export const ManagerRequestRoutes = router;
