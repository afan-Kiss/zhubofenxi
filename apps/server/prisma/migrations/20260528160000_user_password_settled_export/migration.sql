-- AlterTable
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" DATETIME;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;

-- 默认 admin 需修改密码
UPDATE "User" SET "mustChangePassword" = true WHERE "username" = 'admin';

-- 已结算明细默认自动导出
UPDATE "DownloadConfig" SET "mode" = 'auto_export', "url" = 'xhs://settled-export-api' WHERE "type" = 'settledSettlement';
