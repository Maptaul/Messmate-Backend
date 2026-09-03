import httpStatus from "http-status";
import {
	destroyFromCloudinary,
	uploadToCloudinary,
} from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import type { IUpdateProfilePayload } from "./user.interface";

const updateProfile = async (
	payload: IUpdateProfilePayload,
	user: RequestUser,
) => {
	return prisma.user.update({
		where: { id: user.userId },
		data: {
			name: payload.name,
			phone: payload.phone,
		},
		omit: { password: true },
	});
};

const updateProfileImage = async (
	file: Express.Multer.File | undefined,
	user: RequestUser,
) => {
	if (!file) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"No Image Uploaded. Send A File In The avatar Field.",
		);
	}

	const currentUser = await prisma.user.findUnique({
		where: { id: user.userId },
		select: { avatarPublicId: true },
	});

	const uploadResult = await uploadToCloudinary(file, "avatars");

	const updatedUser = await prisma.user.update({
		where: { id: user.userId },
		data: {
			avatarUrl: uploadResult.secure_url,
			avatarPublicId: uploadResult.public_id,
		},
		omit: { password: true },
	});

	if (currentUser?.avatarPublicId) {
		await destroyFromCloudinary(currentUser.avatarPublicId);
	}

	return updatedUser;
};

const removeProfileImage = async (user: RequestUser) => {
	const currentUser = await prisma.user.findUnique({
		where: { id: user.userId },
		select: { avatarPublicId: true },
	});

	if (!currentUser?.avatarPublicId) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"You Have No Profile Image To Remove",
		);
	}

	const updatedUser = await prisma.user.update({
		where: { id: user.userId },
		data: { avatarUrl: null, avatarPublicId: null },
		omit: { password: true },
	});

	await destroyFromCloudinary(currentUser.avatarPublicId);

	return updatedUser;
};

export const UserServices = {
	updateProfile,
	updateProfileImage,
	removeProfileImage,
};
