/*
  Warnings:

  - A unique constraint covering the columns `[userId,sku]` on the table `Item` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('NAVER', 'COUPANG', 'ELEVENST', 'KREAM', 'ETC');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "sku" TEXT;

-- CreateTable
CREATE TABLE "ExternalSkuMap" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalSku" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSkuMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalSkuMap_userId_itemId_idx" ON "ExternalSkuMap"("userId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSkuMap_userId_provider_externalSku_key" ON "ExternalSkuMap"("userId", "provider", "externalSku");

-- CreateIndex
CREATE UNIQUE INDEX "Item_userId_sku_key" ON "Item"("userId", "sku");

-- AddForeignKey
ALTER TABLE "ExternalSkuMap" ADD CONSTRAINT "ExternalSkuMap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSkuMap" ADD CONSTRAINT "ExternalSkuMap_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;
