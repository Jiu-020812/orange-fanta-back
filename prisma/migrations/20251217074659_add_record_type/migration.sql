-- CreateEnum
CREATE TYPE "RecordType" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "Record" ADD COLUMN     "memo" TEXT,
ADD COLUMN     "type" "RecordType" NOT NULL DEFAULT 'IN';
