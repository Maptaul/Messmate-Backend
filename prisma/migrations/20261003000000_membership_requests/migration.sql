-- CreateEnum
CREATE TYPE "MembershipRequestKind" AS ENUM ('INVITE', 'REQUEST');

-- CreateEnum
CREATE TYPE "MembershipRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_JOINED';
ALTER TYPE "AuditAction" ADD VALUE 'MEMBER_LEFT';

-- AlterTable
ALTER TABLE "messes" ADD COLUMN     "joinCode" VARCHAR(12) NOT NULL DEFAULT upper(substr(md5(random()::text), 1, 6));

-- CreateTable
CREATE TABLE "membership_requests" (
    "id" TEXT NOT NULL,
    "kind" "MembershipRequestKind" NOT NULL,
    "status" "MembershipRequestStatus" NOT NULL DEFAULT 'PENDING',
    "note" VARCHAR(300),
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "messId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "membership_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "membership_requests_messId_status_idx" ON "membership_requests"("messId", "status");

-- CreateIndex
CREATE INDEX "membership_requests_userId_status_idx" ON "membership_requests"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messes_joinCode_key" ON "messes"("joinCode");

-- AddForeignKey
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_messId_fkey" FOREIGN KEY ("messId") REFERENCES "messes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex
-- One open invite or request per person and mess; the Prisma schema cannot express a partial index.
CREATE UNIQUE INDEX "membership_requests_messId_userId_pending_key" ON "membership_requests"("messId", "userId") WHERE "status" = 'PENDING';
