-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "allowBrowserCdp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxConcurrentBrowserSessions" INTEGER NOT NULL DEFAULT 2;
