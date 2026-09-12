-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "subjectMemberId" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_subjectMemberId_createdAt_idx" ON "audit_logs"("subjectMemberId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_subjectMemberId_fkey" FOREIGN KEY ("subjectMemberId") REFERENCES "mess_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
