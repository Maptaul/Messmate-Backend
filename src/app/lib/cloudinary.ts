import { type UploadApiResponse, v2 as Cloudinary } from "cloudinary";
import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";

Cloudinary.config({
	cloud_name: config.cloudinary_cloud_name,
	api_key: config.cloudinary_api_key,
	api_secret: config.cloudinary_api_secret,
});

/**
 * Uploads a multer memory buffer to Cloudinary.
 *
 * upload_stream is callback based, so it gets wrapped once here rather than
 * being rebuilt in every service that needs an image. This is also the only
 * file that talks to Cloudinary, which keeps a provider swap to one file.
 */
export const uploadToCloudinary = async (
	file: Express.Multer.File,
	folder: string,
): Promise<UploadApiResponse> => {
	return new Promise<UploadApiResponse>((resolve, reject) => {
		Cloudinary.uploader
			.upload_stream(
				{
					folder: `messmate/${folder}`,
					resource_type: "auto",
				},
				(error, result) => {
					if (error) {
						return reject(
							new AppError(
								httpStatus.BAD_GATEWAY,
								"Image Upload Failed. Please Try Again.",
							),
						);
					}

					if (!result) {
						return reject(
							new AppError(
								httpStatus.BAD_GATEWAY,
								"No Result Returned From Cloudinary",
							),
						);
					}

					resolve(result);
				},
			)
			.end(file.buffer);
	});
};

/**
 * Removes an image. Failure is swallowed on purpose: a leftover file in
 * Cloudinary is untidy, but failing the request that replaced it is worse.
 */
export const destroyFromCloudinary = async (publicId: string) => {
	try {
		await Cloudinary.uploader.destroy(publicId);
	} catch (error) {
		console.error("[cloudinary][destroy]", publicId, error);
	}
};

export const cloudinary = Cloudinary;
