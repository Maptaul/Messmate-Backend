import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

router.get("/callback", PaymentController.paymentCallback);

router.get(
	"/my-bills",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	PaymentController.getMyBills,
);

router.post(
	"/create-payment",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(PaymentValidation.CreatePaymentValidationZodSchema),
	PaymentController.createPayment,
);

router.get(
	"/my-payments",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	PaymentController.getMyPayments,
);

router.get(
	"/:paymentId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	PaymentController.getSinglePayment,
);

export const PaymentRoutes = router;
