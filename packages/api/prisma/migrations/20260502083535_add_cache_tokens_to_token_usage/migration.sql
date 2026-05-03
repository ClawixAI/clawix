-- AlterTable
ALTER TABLE "TokenUsage" ADD COLUMN     "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cacheReadTokens" INTEGER NOT NULL DEFAULT 0;
