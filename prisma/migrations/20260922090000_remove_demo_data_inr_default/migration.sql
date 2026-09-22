ALTER TABLE "Household" ALTER COLUMN "currency" SET DEFAULT 'INR';

UPDATE "Household"
SET "currency" = 'INR'
WHERE "currency" = 'USD';

DELETE FROM "AuditLog"
WHERE "entityType" = 'Transaction'
  AND "entityId" IN (
    SELECT "id"
    FROM "Transaction"
    WHERE "externalId" IN (
      'local:1', 'local:2', 'local:3', 'local:4', 'local:5', 'local:6',
      'local:7', 'local:8', 'local:9', 'local:10', 'local:11', 'local:12',
      'local:13', 'local:14', 'local:15', 'local:16', 'local:17', 'local:18'
    )
    AND "merchant" IN (
      'Whole Foods', 'Acme Studio', 'Spotify', 'Uber', 'Nori House',
      'City Energy', 'Pine Street Homes', 'Target', 'Monthly expenses'
    )
  );

DELETE FROM "Transaction"
WHERE "externalId" IN (
  'local:1', 'local:2', 'local:3', 'local:4', 'local:5', 'local:6',
  'local:7', 'local:8', 'local:9', 'local:10', 'local:11', 'local:12',
  'local:13', 'local:14', 'local:15', 'local:16', 'local:17', 'local:18'
)
AND "merchant" IN (
  'Whole Foods', 'Acme Studio', 'Spotify', 'Uber', 'Nori House',
  'City Energy', 'Pine Street Homes', 'Target', 'Monthly expenses'
);
