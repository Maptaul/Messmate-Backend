import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

router.get("/callback", PaymentController.paymentCallback);

router.get("/result", PaymentController.paymentResult);

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

router.post(
	"/create-stripe-session",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(PaymentValidation.CreatePaymentValidationZodSchema),
	PaymentController.createStripeSession,
);

router.post(
	"/confirm-stripe",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	validateRequest(PaymentValidation.ConfirmStripePaymentValidationZodSchema),
	PaymentController.confirmStripePayment,
);

router.get(
	"/cycle-bills/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	PaymentController.getCycleBills,
);

router.post(
	"/record-cash-payment",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(PaymentValidation.RecordCashPaymentValidationZodSchema),
	PaymentController.recordCashPayment,
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
