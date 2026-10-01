-- CreateEnum
CREATE TYPE "ManagerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'MANAGER_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'MANAGER_REJECTED';

-- CreateTable
CREATE TABLE "manager_applications" (
    "id" TEXT NOT NULL,
    "messName" VARCHAR(120) NOT NULL,
    "messAddress" VARCHAR(300) NOT NULL,
    "status" "ManagerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" VARCHAR(500),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "manager_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manager_applications_status_createdAt_idx" ON "manager_applications"("status", "createdAt");

-- CreateIndex
CREATE INDEX "manager_applications_userId_idx" ON "manager_applications"("userId");

-- AddForeignKey
ALTER TABLE "manager_applications" ADD CONSTRAINT "manager_applications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex
-- One open request per user; the Prisma schema cannot express a partial index.
CREATE UNIQUE INDEX "manager_applications_userId_pending_key" ON "manager_applications"("userId") WHERE "status" = 'PENDING';
