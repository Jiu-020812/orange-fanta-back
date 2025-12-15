-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('SHOE', 'FOOD');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "category" "ItemCategory" NOT NULL DEFAULT 'SHOE';

-- AlterTable
ALTER TABLE "Record" ALTER COLUMN "count" SET DEFAULT 1,
ALTER COLUMN "date" DROP DEFAULT;
