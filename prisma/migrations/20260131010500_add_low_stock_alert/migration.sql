-- Add low stock fields to Item
ALTER TABLE "Item"
ADD COLUMN IF NOT EXISTS "lowStockAlert" BOOLEAN NOT NULL DEFAULT false;
