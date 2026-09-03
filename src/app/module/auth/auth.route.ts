import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";

const router = Router();

router.post(
	"/register",
	validateRequest(AuthValidation.RegisterUserZodSchema),
	AuthController.registerUser,
);

router.post(
	"/verify-email",
	validateRequest(AuthValidation.VerifyEmailZodSchema),
	AuthController.verifyUserEmail,
);

router.post(
	"/login",
	validateRequest(AuthValidation.LoginZodSchema),
	AuthController.loginUser,
);

router.post(
	"/google",
	validateRequest(AuthValidation.GoogleLoginZodSchema),
	AuthController.googleLogin,
);

router.post("/refresh-token", AuthController.refreshToken);

router.post("/logout", AuthController.logoutUser);

router.post(
	"/forgot-password",
	validateRequest(AuthValidation.ForgotPasswordZodSchema),
	AuthController.forgotPassword,
);

router.post(
	"/reset-password",
	validateRequest(AuthValidation.ResetPasswordZodSchema),
	AuthController.resetPassword,
);

router.get(
	"/me",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	AuthController.getMe,
);

export const AuthRoutes = router;
