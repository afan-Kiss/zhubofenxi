-- 待结算明细默认自动导出
UPDATE "DownloadConfig" SET "mode" = 'auto_export', "url" = 'xhs://pending-export-api' WHERE "type" = 'pendingSettlement';
