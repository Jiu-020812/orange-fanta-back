-- AlterEnum
ALTER TYPE "RecordType" ADD VALUE 'PURCHASE';

-- AlterTable
ALTER TABLE "Record" ALTER COLUMN "type" DROP DEFAULT;
