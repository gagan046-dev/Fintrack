DROP INDEX IF EXISTS "Transaction_householdId_taxSection_transactionAt_idx";
ALTER TABLE "Transaction" DROP COLUMN IF EXISTS "taxSection";
