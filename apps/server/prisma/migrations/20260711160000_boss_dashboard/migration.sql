-- CreateTable
CREATE TABLE "BossFundSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "availableAmountCent" INTEGER,
    "withdrawingAmountCent" INTEGER,
    "withdrawnAmountCent" INTEGER,
    "balanceAmountCent" INTEGER,
    "frozenAmountCent" INTEGER,
    "afterSaleFrozenAmountCent" INTEGER,
    "depositBalanceCent" INTEGER,
    "depositRequiredCent" INTEGER,
    "depositStandardCent" INTEGER,
    "baseDueDepositCent" INTEGER,
    "riskDepositCent" INTEGER,
    "debtAmountCent" INTEGER,
    "todayIncomeCent" INTEGER,
    "yesterdayIncomeCent" INTEGER,
    "canWithdraw" BOOLEAN,
    "cannotWithdrawReason" TEXT,
    "leftWithdrawTimesToday" INTEGER,
    "totalWithdrawTimesToday" INTEGER,
    "statementPeriodDays" INTEGER,
    "syncStatus" TEXT NOT NULL DEFAULT 'success',
    "syncError" TEXT,
    "isStale" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BossAccountFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "platformFlowId" TEXT NOT NULL,
    "flowKind" TEXT NOT NULL,
    "flowType" TEXT,
    "flowTypeDesc" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "incomeAmountCent" INTEGER NOT NULL DEFAULT 0,
    "outcomeAmountCent" INTEGER NOT NULL DEFAULT 0,
    "businessNo" TEXT,
    "balanceAfterCent" INTEGER,
    "rawJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BossShopScoreSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopKey" TEXT NOT NULL,
    "liveAccountId" TEXT NOT NULL,
    "scoreDate" TEXT NOT NULL,
    "qualityScore" REAL,
    "logisticsScore" REAL,
    "serviceScore" REAL,
    "officialOverallScore" REAL,
    "sourceApi" TEXT,
    "rawJson" TEXT,
    "fetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BossAnnouncement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "shopKey" TEXT,
    "shopName" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scoreDate" TEXT,
    "metricKey" TEXT,
    "previousScore" REAL,
    "currentScore" REAL,
    "deltaScore" REAL,
    "suggestion" TEXT,
    "tone" TEXT NOT NULL DEFAULT 'neutral',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "dedupeKey" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BossAnnouncementUserState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "readAt" DATETIME,
    "popupShownAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BossSyncRunLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "shopResults" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "BossAccountFlow_shopKey_platformFlowId_key" ON "BossAccountFlow"("shopKey", "platformFlowId");
CREATE INDEX "BossAccountFlow_shopKey_occurredAt_idx" ON "BossAccountFlow"("shopKey", "occurredAt");
CREATE INDEX "BossAccountFlow_shopKey_flowKind_occurredAt_idx" ON "BossAccountFlow"("shopKey", "flowKind", "occurredAt");
CREATE INDEX "BossAccountFlow_liveAccountId_idx" ON "BossAccountFlow"("liveAccountId");

CREATE INDEX "BossFundSnapshot_shopKey_updatedAt_idx" ON "BossFundSnapshot"("shopKey", "updatedAt");
CREATE INDEX "BossFundSnapshot_liveAccountId_idx" ON "BossFundSnapshot"("liveAccountId");

CREATE UNIQUE INDEX "BossShopScoreSnapshot_shopKey_scoreDate_key" ON "BossShopScoreSnapshot"("shopKey", "scoreDate");
CREATE INDEX "BossShopScoreSnapshot_shopKey_scoreDate_idx" ON "BossShopScoreSnapshot"("shopKey", "scoreDate");
CREATE INDEX "BossShopScoreSnapshot_liveAccountId_idx" ON "BossShopScoreSnapshot"("liveAccountId");

CREATE UNIQUE INDEX "BossAnnouncement_dedupeKey_key" ON "BossAnnouncement"("dedupeKey");
CREATE INDEX "BossAnnouncement_kind_enabled_createdAt_idx" ON "BossAnnouncement"("kind", "enabled", "createdAt");
CREATE INDEX "BossAnnouncement_shopKey_createdAt_idx" ON "BossAnnouncement"("shopKey", "createdAt");

CREATE UNIQUE INDEX "BossAnnouncementUserState_userId_announcementId_key" ON "BossAnnouncementUserState"("userId", "announcementId");
CREATE INDEX "BossAnnouncementUserState_userId_idx" ON "BossAnnouncementUserState"("userId");

CREATE INDEX "BossSyncRunLog_startedAt_idx" ON "BossSyncRunLog"("startedAt");
CREATE INDEX "BossSyncRunLog_status_idx" ON "BossSyncRunLog"("status");
