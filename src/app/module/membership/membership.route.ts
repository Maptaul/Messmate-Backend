import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { MembershipController } from "./membership.controller";
import { MembershipValidation } from "./membership.validation";

const router = Router();

router.get(
	"/join-code/:code",
	auth(Role.MEMBER),
	MembershipController.previewJoinCode,
);

router.post(
	"/request",
	auth(Role.MEMBER),
	validateRequest(MembershipValidation.RequestToJoinValidationZodSchema),
	MembershipController.requestToJoin,
);

router.post(
	"/invite",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(MembershipValidation.InviteMemberValidationZodSchema),
	MembershipController.inviteMember,
);

router.get("/my", auth(Role.MEMBER), MembershipController.getMyRequests);

router.get(
	"/mess/:messId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	MembershipController.getMessRequests,
);

router.post(
	"/mess/:messId/join-code",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	MembershipController.regenerateJoinCode,
);

// Who may answer is decided per request (see canDecide in membership.rules).
router.patch(
	"/:id/accept",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MembershipController.accept,
);

router.patch(
	"/:id/decline",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MembershipController.decline,
);

router.patch(
	"/:id/cancel",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MembershipController.cancel,
);

export const MembershipRoutes = router;
