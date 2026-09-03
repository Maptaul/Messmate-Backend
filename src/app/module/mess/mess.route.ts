import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { MessController } from "./mess.controller";
import { MessValidation } from "./mess.validation";

const router = Router();

router.post(
	"/create-mess",
	auth(Role.MESS_MANAGER),
	validateRequest(MessValidation.CreateMessValidationZodSchema),
	MessController.createMess,
);

router.get("/all-messes", auth(Role.ADMIN), MessController.getAllMesses);

router.get(
	"/my-messes",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	MessController.getMyMesses,
);

router.patch(
	"/update-mess/:messId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(MessValidation.UpdateMessValidationZodSchema),
	MessController.updateMess,
);

router.delete(
	"/delete-mess/:messId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	MessController.deleteMess,
);

// Keep the wildcard last so /all-messes and /my-messes are not swallowed by it.
router.get(
	"/:messId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MessController.getSingleMess,
);

export const MessRoutes = router;
