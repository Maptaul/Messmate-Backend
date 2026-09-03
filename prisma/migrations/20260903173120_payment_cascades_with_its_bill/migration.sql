-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_billId_fkey";

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "member_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
