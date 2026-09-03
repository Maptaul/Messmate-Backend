import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";

const router = Router();

router.patch(
	"/update-profile",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(UserValidation.UpdateProfileValidationZodSchema),
	UserController.updateProfile,
);

router.patch(
	"/profile-image",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	upload.single("avatar"),
	UserController.updateProfileImage,
);

router.delete(
	"/profile-image",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	UserController.removeProfileImage,
);

export const UserRoutes = router;
