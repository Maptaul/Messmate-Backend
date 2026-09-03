import multer from "multer";

// Memory storage: the buffer goes straight to Cloudinary, so nothing is ever
// written to disk. Render runs on an ephemeral filesystem anyway.
const storage = multer.memoryStorage();

export const upload = multer({
	storage,
	limits: {
		fileSize: 5 * 1024 * 1024, // 5 MB
	},
});
