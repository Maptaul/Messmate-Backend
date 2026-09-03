import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

// bKash redirects the browser here, so there is no token to check. Everything
// this route is told is verified against bKash before anything is written.
router.get("/callback", PaymentController.paymentCallback);

// Where a member finds the billId they need below. The manager gets a bill too -
// they live in the mess like everyone else.
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

// Wildcard last, so the named routes above are not swallowed by it.
router.get(
	"/:paymentId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	PaymentController.getSinglePayment,
);

export const PaymentRoutes = router;
