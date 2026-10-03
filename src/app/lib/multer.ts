import httpStatus from "http-status";
import multer from "multer";
import { AppError } from "../utils/AppError";

// Vercel refuses a request body over 4.5 MB before it reaches the app.
export const MAX_FILE_SIZE_IN_MB = 4;

const MAX_FILE_SIZE_IN_BYTES = MAX_FILE_SIZE_IN_MB * 1024 * 1024;

// Avatars and expense receipts; the same list the frontend checks.
const ACCEPTED_FILE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/jpg",
	"image/webp",
	"application/pdf",
];

const storage = multer.memoryStorage();

export const upload = multer({
	storage,
	limits: { fileSize: MAX_FILE_SIZE_IN_BYTES },
	fileFilter: (_req, file, cb) => {
		if (!ACCEPTED_FILE_TYPES.includes(file.mimetype)) {
			return cb(
				new AppError(
					httpStatus.BAD_REQUEST,
					`File type not allowed: ${file.originalname}`,
				),
			);
		}
		cb(null, true);
	},
});
