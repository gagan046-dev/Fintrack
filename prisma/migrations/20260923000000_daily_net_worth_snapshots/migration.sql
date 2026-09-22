-- Keep the latest net-worth value for each household and UTC calendar day.
WITH "rankedSnapshots" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "householdId", DATE_TRUNC('day', "recordedAt")
      ORDER BY "recordedAt" DESC, "id" DESC
    ) AS "position"
  FROM "NetWorthSnapshot"
)
DELETE FROM "NetWorthSnapshot"
USING "rankedSnapshots"
WHERE "NetWorthSnapshot"."id" = "rankedSnapshots"."id"
  AND "rankedSnapshots"."position" > 1;

UPDATE "NetWorthSnapshot"
SET "recordedAt" = DATE_TRUNC('day', "recordedAt");

DROP INDEX "NetWorthSnapshot_householdId_recordedAt_idx";
CREATE UNIQUE INDEX "NetWorthSnapshot_householdId_recordedAt_key"
ON "NetWorthSnapshot"("householdId", "recordedAt");