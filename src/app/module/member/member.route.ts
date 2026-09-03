import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { MemberController } from "./member.controller";
import { MemberValidation } from "./member.validation";

const router = Router();

router.post(
	"/add-member",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	validateRequest(MemberValidation.AddMemberValidationZodSchema),
	MemberController.addMember,
);

router.get(
	"/my-memberships",
	auth(Role.MESS_MANAGER, Role.MEMBER),
	MemberController.getMyMemberships,
);

router.get(
	"/mess-members/:messId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	MemberController.getMessMembers,
);

router.patch(
	"/remove-member/:memberId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	MemberController.removeMember,
);

export const MemberRoutes = router;
