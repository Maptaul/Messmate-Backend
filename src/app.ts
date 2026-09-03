import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
	type Application,
	type Request,
	type Response,
} from "express";
import helmet from "helmet";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { authLimiter, generalLimiter } from "./app/middleware/rateLimiter";
import { AdminRoutes } from "./app/module/admin/admin.route";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { CycleRoutes } from "./app/module/cycle/cycle.route";
import { DepositRoutes } from "./app/module/deposit/deposit.route";
import { ExpenseRoutes } from "./app/module/expense/expense.route";
import { GroceryDutyRoutes } from "./app/module/groceryDuty/groceryDuty.route";
import { MealRoutes } from "./app/module/meal/meal.route";
import { MealPlanRoutes } from "./app/module/mealPlan/mealPlan.route";
import { MemberRoutes } from "./app/module/member/member.route";
import { MessRoutes } from "./app/module/mess/mess.route";
import { PaymentRoutes } from "./app/module/payment/payment.route";
import { UserRoutes } from "./app/module/user/user.route";

const app: Application = express();

app.use(helmet());

app.use(
	cors({
		origin: config.frontend_url,
		credentials: true,
	}),
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

app.use("/api/v1/auth", authLimiter);
app.use("/api/v1", generalLimiter);

app.use("/api/v1/auth", AuthRoutes);
app.use("/api/v1/mess", MessRoutes);
app.use("/api/v1/member", MemberRoutes);
app.use("/api/v1/user", UserRoutes);
app.use("/api/v1/cycle", CycleRoutes);
app.use("/api/v1/meal", MealRoutes);
app.use("/api/v1/meal-plan", MealPlanRoutes);
app.use("/api/v1/expense", ExpenseRoutes);
app.use("/api/v1/grocery-duty", GroceryDutyRoutes);
app.use("/api/v1/deposit", DepositRoutes);
app.use("/api/v1/payment", PaymentRoutes);
app.use("/api/v1/admin", AdminRoutes);

app.get("/", async (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		statusCode: httpStatus.OK,
		message: "Welcome to MessMate API",
		data: {
			name: "MessMate",
			description: "Smart Mess & Shared Housing Management Platform",
			version: "v1",
		},
	});
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
