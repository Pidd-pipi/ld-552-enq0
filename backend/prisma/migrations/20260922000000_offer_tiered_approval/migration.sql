-- CreateEnum
CREATE TYPE "OfferApprovalNode" AS ENUM ('HIRING_MANAGER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OfferApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: approverId 改为可空（多级审批期间尚未产生终审人）
ALTER TABLE "Offer" ALTER COLUMN "approverId" DROP NOT NULL;

-- AlterTable: Offer 乐观锁版本号，用于并发冲突检测
ALTER TABLE "Offer" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "OfferApproval" (
    "id" SERIAL NOT NULL,
    "offerId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "node" "OfferApprovalNode" NOT NULL,
    "status" "OfferApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "deciderId" INTEGER,
    "salarySnapshot" DECIMAL(65,30) NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfferApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OfferApproval_offerId_level_key" ON "OfferApproval"("offerId", "level");

-- CreateIndex
CREATE INDEX "OfferApproval_offerId_status_idx" ON "OfferApproval"("offerId", "status");

-- AddForeignKey
ALTER TABLE "OfferApproval" ADD CONSTRAINT "OfferApproval_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferApproval" ADD CONSTRAINT "OfferApproval_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
