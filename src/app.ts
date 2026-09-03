import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
	type Application,
	type Request,
	type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AuthRoutes } from "./app/module/auth/auth.route";

const app: Application = express();

app.use(helmet());

app.use(
	cors({
		origin: config.frontend_url,
		credentials: true,
	}),
);

// bKash posts form-encoded bodies, so urlencoded is parsed before json.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// Auth has its own tighter limiter, and the bKash callback must never be
// throttled - dropping a gateway call drops a real settlement. Both are skipped
// here rather than being counted twice against this budget.
const generalLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 300,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	skip: (req) =>
		req.originalUrl.startsWith("/api/v1/auth") ||
		req.originalUrl.startsWith("/api/v1/payment/callback"),
	message: {
		success: false,
		statusCode: httpStatus.TOO_MANY_REQUESTS,
		message: "Too many requests. Please try again later.",
		errors: [],
	},
});

// Login and register are the brute-force targets, so they get a tighter budget.
const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	limit: 30,
	standardHeaders: "draft-7",
	legacyHeaders: false,
	message: {
		success: false,
		statusCode: httpStatus.TOO_MANY_REQUESTS,
		message: "Too many authentication attempts. Please try again later.",
		errors: [],
	},
});

app.use("/api/v1/auth", authLimiter);
app.use("/api/v1", generalLimiter);

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

app.use("/api/v1/auth", AuthRoutes);

app.use(globalErrorHandler);
app.use(notFound);

export default app;
