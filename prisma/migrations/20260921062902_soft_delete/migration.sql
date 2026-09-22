-- DropIndex
DROP INDEX "Transaction_householdId_transactionAt_idx";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Transaction_householdId_deletedAt_transactionAt_idx" ON "Transaction"("householdId", "deletedAt", "transactionAt");
