UPDATE "Account"
SET "openingBalance" = "balance"
WHERE "version" = 0
  AND "openingBalance" = 0;
