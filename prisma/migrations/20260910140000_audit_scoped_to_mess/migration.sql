-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "messId" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_messId_createdAt_idx" ON "audit_logs"("messId", "createdAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_messId_fkey" FOREIGN KEY ("messId") REFERENCES "messes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
