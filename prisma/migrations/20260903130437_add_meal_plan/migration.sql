-- CreateTable
CREATE TABLE "meal_plans" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "lunch" INTEGER NOT NULL DEFAULT 0,
    "dinner" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cycleId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_plans_cycleId_date_idx" ON "meal_plans"("cycleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plans_memberId_date_key" ON "meal_plans"("memberId", "date");

-- AddForeignKey
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "billing_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "mess_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
