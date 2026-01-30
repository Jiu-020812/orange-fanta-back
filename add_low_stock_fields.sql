-- Add low stock alert fields to Item table
ALTER TABLE "Item"
ADD COLUMN IF NOT EXISTS "lowStockAlert" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER NOT NULL DEFAULT 10;
