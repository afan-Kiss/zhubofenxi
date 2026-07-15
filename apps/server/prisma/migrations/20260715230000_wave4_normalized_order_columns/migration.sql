-- AlterTable
ALTER TABLE "XhsRawOrder" ADD COLUMN "paymentTime" DATETIME;
ALTER TABLE "XhsRawOrder" ADD COLUMN "orderedAt" DATETIME;
ALTER TABLE "XhsRawOrder" ADD COLUMN "displayOrderNo" TEXT;
ALTER TABLE "XhsRawOrder" ADD COLUMN "gmvCent" INTEGER;
ALTER TABLE "XhsRawOrder" ADD COLUMN "productAmountCent" INTEGER;
ALTER TABLE "XhsRawOrder" ADD COLUMN "actualPaidCent" INTEGER;
ALTER TABLE "XhsRawOrder" ADD COLUMN "sellerReceiveCent" INTEGER;
ALTER TABLE "XhsRawOrder" ADD COLUMN "freightCent" INTEGER;
ALTER TABLE "XhsRawOrder" ADD COLUMN "platformDiscountCent" INTEGER;
ALTER TABLE "XhsRawOrder" ADD COLUMN "orderStatusText" TEXT;
ALTER TABLE "XhsRawOrder" ADD COLUMN "afterSaleStatusText" TEXT;
ALTER TABLE "XhsRawOrder" ADD COLUMN "isSigned" BOOLEAN;
ALTER TABLE "XhsRawOrder" ADD COLUMN "isReturned" BOOLEAN;
ALTER TABLE "XhsRawOrder" ADD COLUMN "isQualityReturn" BOOLEAN;
ALTER TABLE "XhsRawOrder" ADD COLUMN "normalizedVersion" TEXT;
ALTER TABLE "XhsRawOrder" ADD COLUMN "businessFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "XhsRawOrder_paymentTime_idx" ON "XhsRawOrder"("paymentTime");
CREATE INDEX "XhsRawOrder_orderedAt_idx" ON "XhsRawOrder"("orderedAt");
CREATE INDEX "XhsRawOrder_liveAccountId_paymentTime_idx" ON "XhsRawOrder"("liveAccountId", "paymentTime");
CREATE INDEX "XhsRawOrder_liveAccountId_displayOrderNo_idx" ON "XhsRawOrder"("liveAccountId", "displayOrderNo");
CREATE INDEX "XhsRawOrder_paymentTime_isReturned_idx" ON "XhsRawOrder"("paymentTime", "isReturned");
CREATE INDEX "XhsRawOrder_normalizedVersion_idx" ON "XhsRawOrder"("normalizedVersion");
