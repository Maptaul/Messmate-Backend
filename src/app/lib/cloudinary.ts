import { type UploadApiResponse, v2 as Cloudinary } from "cloudinary";
import httpStatus from "http-status";
import config from "../config";
import { AppError } from "../utils/AppError";

Cloudinary.config({
	cloud_name: config.cloudinary_cloud_name,
	api_key: config.cloudinary_api_key,
	api_secret: config.cloudinary_api_secret,
});

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

export const destroyFromCloudinary = async (publicId: string) => {
	try {
		await Cloudinary.uploader.destroy(publicId);
	} catch (error) {
		console.error("[cloudinary][destroy]", publicId, error);
	}
};

export const cloudinary = Cloudinary;
