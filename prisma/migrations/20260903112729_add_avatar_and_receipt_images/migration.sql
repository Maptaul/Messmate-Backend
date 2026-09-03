-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "receiptPublicId" VARCHAR(255),
ADD COLUMN     "receiptUrl" VARCHAR(500);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarPublicId" VARCHAR(255);
