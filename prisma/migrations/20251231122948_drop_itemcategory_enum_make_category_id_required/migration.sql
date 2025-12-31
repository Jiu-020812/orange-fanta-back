/*
  Warnings:

  - You are about to drop the column `category` on the `Item` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,categoryId,legacyId]` on the table `Item` will be added. If there are existing duplicate values, this will fail.
  - Made the column `categoryId` on table `Item` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Item_userId_category_legacyId_key";

-- AlterTable
ALTER TABLE "Item" DROP COLUMN "category",
ALTER COLUMN "categoryId" SET NOT NULL;

-- DropEnum
DROP TYPE "ItemCategory";

-- CreateIndex
CREATE UNIQUE INDEX "Item_userId_categoryId_legacyId_key" ON "Item"("userId", "categoryId", "legacyId");
