/*
  Warnings:

  - A unique constraint covering the columns `[userId,category,legacyId]` on the table `Item` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "legacyId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Item_userId_category_legacyId_key" ON "Item"("userId", "category", "legacyId");
