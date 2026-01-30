-- Backfill lowStockThreshold nulls and enforce NOT NULL
UPDATE "Item"
SET "lowStockThreshold" = 10
WHERE "lowStockThreshold" IS NULL;

ALTER TABLE "Item"
ALTER COLUMN "lowStockThreshold" SET DEFAULT 10;

ALTER TABLE "Item"
ALTER COLUMN "lowStockThreshold" SET NOT NULL;
