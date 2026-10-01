import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { MemberController } from "./member.controller";

const router = Router();

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

// Adding someone is an invitation now: see /membership/invite.
router.patch("/leave/:messId", auth(Role.MEMBER), MemberController.leaveMess);

export const MemberRoutes = router;
