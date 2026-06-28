-- AlterTable
ALTER TABLE "User" ADD COLUMN "registeredIp" TEXT;
ALTER TABLE "User" ADD COLUMN "registeredUserAgent" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginIp" TEXT;
ALTER TABLE "User" ADD COLUMN "lastLoginUserAgent" TEXT;
