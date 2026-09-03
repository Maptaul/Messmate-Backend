import multer from "multer";

// Memory storage: the buffer goes straight to Cloudinary, so nothing is ever
// written to disk. Serverless filesystems are read-only and ephemeral anyway,
// so there is nowhere to put a temp file even if we wanted one.
const storage = multer.memoryStorage();

export const upload = multer({
	storage,
	limits: {
		// Under Vercel's 4.5 MB serverless request-body cap. A larger limit would
		// be a lie: the platform rejects the request before multer ever sees it,
		// so the caller would get a platform error instead of ours.
		fileSize: 4 * 1024 * 1024, // 4 MB
	},
});
