-- AlterTable
ALTER TABLE "DownloadConfig" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'direct_url';
ALTER TABLE "DownloadConfig" ADD COLUMN "sellerId" TEXT;

-- AlterTable
ALTER TABLE "DownloadTask" ADD COLUMN "mode" TEXT;

-- live 默认使用接口自动导出
UPDATE "DownloadConfig" SET "mode" = 'auto_export', "url" = 'xhs://live-export-api' WHERE "type" = 'live';
