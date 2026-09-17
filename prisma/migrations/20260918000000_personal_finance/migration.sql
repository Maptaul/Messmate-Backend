-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "FinanceCategory" AS ENUM ('SALARY', 'TUITION', 'FAMILY', 'BUSINESS', 'FOOD', 'MESS', 'TRANSPORT', 'EDUCATION', 'MOBILE_INTERNET', 'HEALTH', 'SHOPPING', 'ENTERTAINMENT', 'OTHER');

-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "category" "FinanceCategory" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL,
    "note" VARCHAR(300),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_entries_userId_date_idx" ON "finance_entries"("userId", "date");

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

