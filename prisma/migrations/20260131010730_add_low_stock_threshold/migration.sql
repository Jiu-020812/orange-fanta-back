-- Add low stock threshold to Item
ALTER TABLE "Item"
ADD COLUMN IF NOT EXISTS "lowStockThreshold" INTEGER;
