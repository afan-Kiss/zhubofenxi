-- XhsSyncJob progress fields (schema drift fix; additive only)
ALTER TABLE "XhsSyncJob" ADD COLUMN "currentPage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "XhsSyncJob" ADD COLUMN "totalPage" INTEGER;
ALTER TABLE "XhsSyncJob" ADD COLUMN "currentApiKey" TEXT;
ALTER TABLE "XhsSyncJob" ADD COLUMN "currentApiLabel" TEXT;
ALTER TABLE "XhsSyncJob" ADD COLUMN "rangeLabel" TEXT;
