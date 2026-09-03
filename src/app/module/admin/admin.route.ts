import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AdminController } from "./admin.controller";
import { AdminValidation } from "./admin.validation";

const router = Router();

router.get(
	"/dashboard-stats",
	auth(Role.ADMIN),
	AdminController.getDashboardStats,
);

router.get("/audit-logs", auth(Role.ADMIN), AdminController.getAuditLogs);

router.get("/users", auth(Role.ADMIN), AdminController.getAllUsers);

router.get("/users/:userId", auth(Role.ADMIN), AdminController.getSingleUser);

router.patch(
	"/users/:userId/role",
	auth(Role.ADMIN),
	validateRequest(AdminValidation.ChangeRoleValidationZodSchema),
	AdminController.changeUserRole,
);

router.patch(
	"/users/:userId/status",
	auth(Role.ADMIN),
	validateRequest(AdminValidation.ChangeStatusValidationZodSchema),
	AdminController.changeUserStatus,
);

export const AdminRoutes = router;
