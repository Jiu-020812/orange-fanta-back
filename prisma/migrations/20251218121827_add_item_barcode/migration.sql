/*
  Warnings:

  - A unique constraint covering the columns `[userId,barcode]` on the table `Item` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "barcode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Item_userId_barcode_key" ON "Item"("userId", "barcode");
