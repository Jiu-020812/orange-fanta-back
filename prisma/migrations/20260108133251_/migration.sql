-- AlterTable
ALTER TABLE "Record" ADD COLUMN     "purchaseId" INTEGER;

-- CreateIndex
CREATE INDEX "Record_purchaseId_idx" ON "Record"("purchaseId");

-- AddForeignKey
ALTER TABLE "Record" ADD CONSTRAINT "Record_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Record"("id") ON DELETE SET NULL ON UPDATE CASCADE;
