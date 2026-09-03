import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ExpenseController } from "./expense.controller";
import { ExpenseValidation } from "./expense.validation";

const router = Router();

router.post(
	"/add-expense",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	upload.single("receipt"),
	validateRequest(ExpenseValidation.AddExpenseValidationZodSchema),
	ExpenseController.addExpense,
);

router.get(
	"/cycle-expenses/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	ExpenseController.getCycleExpenses,
);

router.get(
	"/expense-summary/:cycleId",
	auth(Role.ADMIN, Role.MESS_MANAGER, Role.MEMBER),
	ExpenseController.getExpenseSummary,
);

router.patch(
	"/update-expense/:expenseId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	upload.single("receipt"),
	validateRequest(ExpenseValidation.UpdateExpenseValidationZodSchema),
	ExpenseController.updateExpense,
);

router.delete(
	"/delete-expense/:expenseId",
	auth(Role.ADMIN, Role.MESS_MANAGER),
	ExpenseController.deleteExpense,
);

export const ExpenseRoutes = router;
