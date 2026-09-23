ALTER TABLE "Transaction" ADD COLUMN "taxSection" TEXT;
CREATE INDEX "Transaction_householdId_taxSection_transactionAt_idx" ON "Transaction"("householdId", "taxSection", "transactionAt");
