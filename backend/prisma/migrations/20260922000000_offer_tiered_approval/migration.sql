-- AlterEnum
CREATE TYPE "OfferStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');
ALTER TABLE "Offer" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Offer" ALTER COLUMN "status" TYPE "OfferStatus_new" USING ("status"::"text"::"OfferStatus_new");
ALTER TABLE "Offer" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "OfferStatus";
ALTER TYPE "OfferStatus_new" RENAME TO "OfferStatus";

-- CreateEnum
CREATE TYPE "ApprovalLevel" AS ENUM ('HIRING_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OfferApprovalResult" AS ENUM ('APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN "effectiveSalary" DECIMAL(65,30),
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OfferApproval" (
    "id" SERIAL NOT NULL,
    "offerId" INTEGER NOT NULL,
    "level" "ApprovalLevel" NOT NULL,
    "result" "OfferApprovalResult" NOT NULL,
    "approverId" INTEGER NOT NULL,
    "comment" TEXT,
    "salarySnap" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferApproval_offerId_level_key" ON "OfferApproval"("offerId", "level");

-- CreateIndex
CREATE INDEX "OfferApproval_offerId_idx" ON "OfferApproval"("offerId");

-- AddForeignKey
ALTER TABLE "OfferApproval" ADD CONSTRAINT "OfferApproval_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApproval" ADD CONSTRAINT "OfferApproval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
