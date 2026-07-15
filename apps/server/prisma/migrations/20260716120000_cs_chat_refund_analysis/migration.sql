-- CreateTable
CREATE TABLE "CsChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopTitle" TEXT NOT NULL,
    "appCid" TEXT NOT NULL,
    "buyerNick" TEXT,
    "modifyTime" BIGINT,
    "createAt" BIGINT,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageText" TEXT,
    "lastMessageAt" BIGINT,
    "hasImage" BOOLEAN NOT NULL DEFAULT false,
    "refundMention" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CsChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "shopTitle" TEXT NOT NULL,
    "appCid" TEXT NOT NULL,
    "msgId" TEXT NOT NULL,
    "buyerNick" TEXT,
    "contentType" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "imageUrlsJson" TEXT NOT NULL DEFAULT '[]',
    "thumbUrl" TEXT,
    "senderType" TEXT,
    "createAt" BIGINT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CsChatSyncMeta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSyncedAt" DATETIME,
    "source" TEXT,
    "summaryJson" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CsChatSession_shopTitle_appCid_key" ON "CsChatSession"("shopTitle", "appCid");

-- CreateIndex
CREATE INDEX "CsChatSession_shopTitle_modifyTime_idx" ON "CsChatSession"("shopTitle", "modifyTime");

-- CreateIndex
CREATE INDEX "CsChatSession_modifyTime_idx" ON "CsChatSession"("modifyTime");

-- CreateIndex
CREATE INDEX "CsChatSession_refundMention_idx" ON "CsChatSession"("refundMention");

-- CreateIndex
CREATE UNIQUE INDEX "CsChatMessage_shopTitle_msgId_key" ON "CsChatMessage"("shopTitle", "msgId");

-- CreateIndex
CREATE INDEX "CsChatMessage_sessionId_createAt_idx" ON "CsChatMessage"("sessionId", "createAt");

-- CreateIndex
CREATE INDEX "CsChatMessage_shopTitle_appCid_idx" ON "CsChatMessage"("shopTitle", "appCid");
